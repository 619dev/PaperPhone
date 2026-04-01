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
const { pushToUser } = require('../services/push');
const { pushToUserOneSignal } = require('../services/onesignal');

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
          ws.sessionId = payload.session_id || null;
          registerClient(payload.id, ws);

          // Check if session is revoked
          if (ws.sessionId) {
            const db2 = getDb();
            const [sessRows] = await db2.query(
              'SELECT revoked FROM sessions WHERE id = ? AND user_id = ?',
              [ws.sessionId, payload.id]
            );
            if (sessRows.length > 0 && sessRows[0].revoked === 1) {
              ws.send(JSON.stringify({ type: 'session_revoked' }));
              ws.close();
              return;
            }
          }

          // Mark online
          const db = getDb();
          await db.query('UPDATE users SET is_online = 1, last_seen = NOW() WHERE id = ?', [payload.id]);
          const redis = getRedis();
          await redis.set(`online:${payload.id}`, '1', { EX: 86400 });

          ws.send(JSON.stringify({ type: 'auth_ok', user_id: payload.id }));

          // Flush pending call signaling from Redis (call_offer / call_invite)
          await flushPendingCallSignaling(payload.id, ws, redis);

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
          `INSERT INTO messages (id, type, from_id, to_id, ciphertext, header, self_ciphertext, self_header, msg_type, delivered)
           VALUES (?, 'private', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [msgId, ws.userId, msg.to, msg.ciphertext, msg.header || null, msg.self_ciphertext || null, msg.self_header || null, msg.msg_type || 'text', delivered ? 1 : 0]
        );
        // Push notification when recipient is offline
        if (!delivered) {
          const [senderRows] = await db.query('SELECT nickname, username FROM users WHERE id = ?', [ws.userId]);
          const senderName = senderRows[0]?.nickname || senderRows[0]?.username || 'Someone';
          const pushPayload = {
            type: 'message',
            title: 'PaperPhone',
            body: `${senderName} sent you a message`,
            data: { type: 'message', from: ws.userId },
          };
          pushToUser(msg.to, pushPayload).catch(() => {});
          pushToUserOneSignal(msg.to, pushPayload).catch(() => {});
        }
        // ACK sender
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ack', msg_id: msgId, ts: Date.now() }));
        }
      }

      // ── GROUP MESSAGE ─────────────────────────────────────────────────
      if (msg.type === 'message' && msg.group_id) {
        const msgId = uuidv4();
        const db = getDb();
        // Lookup sender nickname for display
        const [senderRows] = await db.query('SELECT nickname, avatar FROM users WHERE id = ?', [ws.userId]);
        const fromNick = senderRows[0]?.nickname || '';
        const fromAvatar = senderRows[0]?.avatar || null;
        const envelope = {
          type: 'message',
          id: msgId,
          from: ws.userId,
          from_nickname: fromNick,
          from_avatar: fromAvatar,
          group_id: msg.group_id,
          msg_type: msg.msg_type || 'text',
          ciphertext: msg.ciphertext,
          header: msg.header || null,
          ts: Date.now(),
        };
        // Store in DB for offline group members
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

      // ── MSG_READ — mark messages as read ────────────────────────────
      if (msg.type === 'msg_read' && Array.isArray(msg.msg_ids) && msg.msg_ids.length) {
        const db = getDb();
        // Only mark messages addressed to the current user (prevent spoofing)
        const placeholders = msg.msg_ids.map(() => '?').join(',');
        await db.query(
          `UPDATE messages SET read_at = NOW()
           WHERE id IN (${placeholders}) AND to_id = ? AND read_at IS NULL`,
          [...msg.msg_ids, ws.userId]
        );
        // Relay read receipt to each message's sender
        const [rows] = await db.query(
          `SELECT DISTINCT from_id FROM messages WHERE id IN (${placeholders})`,
          msg.msg_ids
        );
        for (const { from_id } of rows) {
          sendToUser(from_id, {
            type: 'msg_read',
            msg_ids: msg.msg_ids,
            reader: ws.userId,
            ts: Date.now(),
          });
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
          const delivered = sendToUser(msg.to, envelope);
          // Store call_offer / call_invite in Redis so they survive WS drops.
          // When the callee reconnects, flushPendingCallSignaling will deliver it.
          if (msg.type === 'call_offer' || msg.type === 'call_invite') {
            const redis = getRedis();
            await redis.set(
              `pending_call:${msg.to}`,
              JSON.stringify(envelope),
              { EX: 60 } // expire after 60 seconds
            ).catch(() => {});
          }
        } else if (msg.group_id) {
          // Group call — broadcast to all group members except sender
          await sendToGroup(msg.group_id, envelope, ws.userId);
          // Store pending call for offline group members
          if (msg.type === 'call_offer' || msg.type === 'call_invite') {
            const db = getDb();
            const redis = getRedis();
            const [members] = await db.query(
              'SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?',
              [msg.group_id, ws.userId]
            );
            for (const { user_id } of members) {
              await redis.set(
                `pending_call:${user_id}`,
                JSON.stringify(envelope),
                { EX: 60 }
              ).catch(() => {});
            }
          }
        }

        // Clean up pending call signaling from Redis on end/reject/cancel
        if (['call_end', 'call_reject', 'call_cancel'].includes(msg.type)) {
          const redis = getRedis();
          if (msg.to) {
            await redis.del(`pending_call:${msg.to}`).catch(() => {});
          }
          // Also clear our own pending call (the other party might have stored one for us)
          await redis.del(`pending_call:${ws.userId}`).catch(() => {});
        }

        // ── Push notification for incoming calls ─────────────────────
        // Send push even if the user is online, because the app may be
        // in the background and the WebSocket message alone won't wake it.
        if (msg.type === 'call_offer' || msg.type === 'call_invite') {
          const db = getDb();
          const [senderRows] = await db.query(
            'SELECT nickname, username FROM users WHERE id = ?', [ws.userId]
          );
          const senderName = senderRows[0]?.nickname || senderRows[0]?.username || 'Someone';
          const isVideo = !!msg.is_video;
          const pushPayload = {
            type: 'incoming_call',
            title: 'PaperPhone',
            body: isVideo
              ? `${senderName} invites you to a video call`
              : `${senderName} invites you to a voice call`,
            data: {
              type: 'incoming_call',
              from: ws.userId,
              call_id: msg.call_id,
              is_video: isVideo,
            },
          };

          if (msg.to) {
            // 1-to-1 call push
            pushToUser(msg.to, pushPayload).catch(() => {});
            pushToUserOneSignal(msg.to, pushPayload).catch(() => {});
          } else if (msg.group_id) {
            // Group call push — notify all members except caller
            const [members] = await db.query(
              'SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?',
              [msg.group_id, ws.userId]
            );
            for (const { user_id } of members) {
              pushToUser(user_id, pushPayload).catch(() => {});
              pushToUserOneSignal(user_id, pushPayload).catch(() => {});
            }
          }
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

/**
 * Deliver any pending call signaling stored in Redis when user reconnects.
 * This handles the case where a call_offer or call_invite was sent while the
 * user's WebSocket was disconnected (e.g. app backgrounded on mobile).
 */
async function flushPendingCallSignaling(userId, ws, redis) {
  try {
    const raw = await redis.get(`pending_call:${userId}`);
    if (!raw) return;

    const signaling = JSON.parse(raw);
    if (ws.readyState === 1 /* WebSocket.OPEN */) {
      ws.send(raw); // already a JSON string
    }
    // Delete after delivery — the callee now has the offer
    await redis.del(`pending_call:${userId}`).catch(() => {});
  } catch { /* ignore parse/network errors */ }
}

async function flushOfflineMessages(userId, ws, db) {
  // Private messages
  const [rows] = await db.query(
    `SELECT id, from_id, to_id, ciphertext, header, self_ciphertext, self_header, msg_type, created_at, read_at, type
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
      read_at: row.read_at ? new Date(row.read_at).getTime() : null,
      offline: true,
    };
    ws.send(JSON.stringify(envelope));
    await db.query('UPDATE messages SET delivered = 1 WHERE id = ?', [row.id]);
  }

  // Group messages — flush unread group messages user missed
  const [groupRows] = await db.query(
    `SELECT m.id, m.from_id, m.to_id AS group_id, m.ciphertext, m.header, m.msg_type, m.created_at,
            u.nickname AS from_nickname, u.avatar AS from_avatar
     FROM messages m
     LEFT JOIN users u ON u.id = m.from_id
     WHERE m.type = 'group'
       AND m.to_id IN (SELECT group_id FROM group_members WHERE user_id = ?)
       AND m.from_id != ?
       AND m.created_at > COALESCE(
         (SELECT last_active FROM sessions WHERE user_id = ? AND revoked = 0 ORDER BY last_active DESC LIMIT 1),
         DATE_SUB(NOW(), INTERVAL 7 DAY)
       )
     ORDER BY m.created_at ASC
     LIMIT 200`,
    [userId, userId, userId]
  );
  for (const row of groupRows) {
    const envelope = {
      type: 'message',
      id: row.id,
      from: row.from_id,
      from_nickname: row.from_nickname || '',
      from_avatar: row.from_avatar || null,
      group_id: row.group_id,
      msg_type: row.msg_type,
      ciphertext: row.ciphertext,
      ts: new Date(row.created_at).getTime(),
      offline: true,
    };
    ws.send(JSON.stringify(envelope));
  }
}

/**
 * Revoke a session via WebSocket — notify the client and close the connection.
 */
function revokeSessionWs(userId, sessionId) {
  const sockets = clients.get(userId);
  if (!sockets) return;
  for (const ws of sockets) {
    if (ws.sessionId === sessionId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'session_revoked' }));
      ws.close();
    }
  }
}

module.exports = { initWsServer, sendToUser, sendToGroup, getWsClients, revokeSessionWs };
