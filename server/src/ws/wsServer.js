/**
 * WebSocket Server - PaperPhone message broker
 *
 * Message types (client → server):
 *   auth       { type, token }
 *   message    { type, to, msg_type, ciphertext, header, group_id? }
 *   typing     { type, to, group_id? }
 *   ack        { type, msg_id }
 *
 * Message types (server → client):
 *   message, typing, ack, online, offline, friend_request, friend_accepted,
 *   group_member_added, error
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/mysql');
const { getRedis } = require('../db/redis');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// userId -> Set<WebSocket>
const clients = new Map();

function registerClient(userId, ws) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(ws);
}

function removeClient(userId, ws) {
  const sockets = clients.get(userId);
  if (sockets) {
    sockets.delete(ws);
    if (sockets.size === 0) clients.delete(userId);
  }
}

function sendToUser(userId, payload) {
  const sockets = clients.get(userId);
  if (sockets && sockets.size > 0) {
    const data = JSON.stringify(payload);
    sockets.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
    return true;
  }
  return false;
}

async function sendToGroup(groupId, payload, excludeUserId) {
  const db = getDb();
  const [members] = await db.query(
    'SELECT user_id FROM group_members WHERE group_id = ?',
    [groupId]
  );
  const data = JSON.stringify(payload);
  members.forEach(({ user_id }) => {
    if (user_id === excludeUserId) return;
    const sockets = clients.get(user_id);
    if (sockets) sockets.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  });
}

function getWsClients() { return clients; }

function initWsServer(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer });

  wss.on('connection', (ws) => {
    ws.userId = null;
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // ── AUTH ─────────────────────────────────────────────────────────
      if (msg.type === 'auth') {
        try {
          const payload = jwt.verify(msg.token, JWT_SECRET);
          ws.userId = payload.id;
          registerClient(payload.id, ws);

          // Mark online
          const db = getDb();
          await db.query('UPDATE users SET is_online = 1, last_seen = NOW() WHERE id = ?', [payload.id]);
          const redis = getRedis();
          await redis.set(`online:${payload.id}`, '1', { EX: 86400 });

          ws.send(JSON.stringify({ type: 'auth_ok', user_id: payload.id }));

          // Flush offline messages stored in DB
          await flushOfflineMessages(payload.id, ws, db);
        } catch {
          ws.send(JSON.stringify({ type: 'error', msg: 'Auth failed' }));
        }
        return;
      }

      if (!ws.userId) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Not authenticated' }));
        return;
      }

      // ── PRIVATE MESSAGE ───────────────────────────────────────────────
      if (msg.type === 'message' && msg.to && !msg.group_id) {
        const msgId = uuidv4();
        const envelope = {
          type: 'message',
          id: msgId,
          from: ws.userId,
          to: msg.to,
          msg_type: msg.msg_type || 'text',
          ciphertext: msg.ciphertext,
          header: msg.header || null,
          ts: Date.now(),
        };
        const delivered = sendToUser(msg.to, envelope);
        // Always persist to DB for history; mark delivered immediately if online
        const db = getDb();
        await db.query(
          `INSERT INTO messages (id, type, from_id, to_id, ciphertext, header, msg_type, delivered)
           VALUES (?, 'private', ?, ?, ?, ?, ?, ?)`,
          [msgId, ws.userId, msg.to, msg.ciphertext, msg.header || null, msg.msg_type || 'text', delivered ? 1 : 0]
        );
        // ACK sender
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ack', msg_id: msgId, ts: Date.now() }));
        }
      }

      // ── GROUP MESSAGE ─────────────────────────────────────────────────
      if (msg.type === 'message' && msg.group_id) {
        const msgId = uuidv4();
        const envelope = {
          type: 'message',
          id: msgId,
          from: ws.userId,
          group_id: msg.group_id,
          msg_type: msg.msg_type || 'text',
          ciphertext: msg.ciphertext,
          header: msg.header || null,
          ts: Date.now(),
        };
        // Store in DB for offline group members
        const db = getDb();
        await db.query(
          `INSERT INTO messages (id, type, from_id, to_id, ciphertext, header, msg_type)
           VALUES (?, 'group', ?, ?, ?, ?, ?)`,
          [msgId, ws.userId, msg.group_id, msg.ciphertext, msg.header || null, msg.msg_type || 'text']
        );
        await sendToGroup(msg.group_id, envelope, ws.userId);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ack', msg_id: msgId, ts: Date.now() }));
        }
      }

      // ── TYPING ────────────────────────────────────────────────────────
      if (msg.type === 'typing') {
        const payload = { type: 'typing', from: ws.userId };
        if (msg.group_id) {
          await sendToGroup(msg.group_id, payload, ws.userId);
        } else if (msg.to) {
          sendToUser(msg.to, payload);
        }
      }

      // ── CALL SIGNALING ────────────────────────────────────────────────
      // Relay call_offer, call_answer, call_reject, call_cancel,
      //        call_end, ice_candidate, call_invite transparently.
      const CALL_RELAY_TYPES = [
        'call_offer', 'call_answer', 'call_reject', 'call_cancel',
        'call_end', 'ice_candidate', 'call_invite',
      ];
      if (CALL_RELAY_TYPES.includes(msg.type)) {
        const envelope = { ...msg, from: ws.userId };
        if (msg.to) {
          // 1-to-1 signaling
          sendToUser(msg.to, envelope);
        } else if (msg.group_id) {
          // Group call — broadcast to all group members except sender
          await sendToGroup(msg.group_id, envelope, ws.userId);
        }
      }
    });

    ws.on('close', async () => {
      if (ws.userId) {
        removeClient(ws.userId, ws);
        if (!clients.has(ws.userId)) {
          // Last session — mark offline
          const db = getDb();
          await db.query('UPDATE users SET is_online = 0, last_seen = NOW() WHERE id = ?', [ws.userId]);
          const redis = getRedis();
          await redis.del(`online:${ws.userId}`);
        }
      }
    });

    ws.on('error', (err) => console.error('WS error:', err.message));
  });

  // Heartbeat
  setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  console.log('✅ WebSocket server initialized');
  return wss;
}

async function flushOfflineMessages(userId, ws, db) {
  const [rows] = await db.query(
    `SELECT id, from_id, to_id, ciphertext, header, msg_type, created_at, type
     FROM messages
     WHERE to_id = ? AND delivered = 0 AND type = 'private'
     ORDER BY created_at ASC`,
    [userId]
  );
  for (const row of rows) {
    const envelope = {
      type: 'message',
      id: row.id,
      from: row.from_id,
      to: row.to_id,
      msg_type: row.msg_type,
      ciphertext: row.ciphertext,
      header: row.header,
      ts: new Date(row.created_at).getTime(),
      offline: true,
    };
    ws.send(JSON.stringify(envelope));
    await db.query('UPDATE messages SET delivered = 1 WHERE id = ?', [row.id]);
  }
}

module.exports = { initWsServer, sendToUser, sendToGroup, getWsClients };
