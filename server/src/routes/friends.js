const express = require('express');
const { getDb } = require('../db/mysql');
const { authMiddleware } = require('../middlewares/auth');
const { getWsClients, sendToUser } = require('../ws/wsServer');
const { pushToUser } = require('../services/push');
const { pushToUserOneSignal } = require('../services/onesignal');

const router = express.Router();
router.use(authMiddleware);

// GET /api/friends — list accepted friends (with tags)
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const [rows] = await db.query(
      `SELECT u.id, u.username, u.nickname, u.avatar, u.is_online, u.last_seen, f.auto_delete
       FROM friends f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = ? AND f.status = 'accepted'`,
      [req.user.id]
    );
    // Attach tags for each friend
    if (rows.length) {
      const friendIds = rows.map(r => r.id);
      const placeholders = friendIds.map(() => '?').join(',');
      const [tagRows] = await db.query(
        `SELECT a.friend_id, t.id as tag_id, t.name as tag_name, t.color as tag_color
         FROM friend_tag_assignments a
         JOIN friend_tags t ON t.id = a.tag_id
         WHERE t.user_id = ? AND a.friend_id IN (${placeholders})`,
        [req.user.id, ...friendIds]
      );
      const tagMap = {};
      tagRows.forEach(r => {
        if (!tagMap[r.friend_id]) tagMap[r.friend_id] = [];
        tagMap[r.friend_id].push({ id: r.tag_id, name: r.tag_name, color: r.tag_color });
      });
      rows.forEach(r => { r.tags = tagMap[r.id] || []; });
    }
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/friends/requests — pending requests received
router.get('/requests', async (req, res, next) => {
  try {
    const db = getDb();
    const [rows] = await db.query(
      `SELECT f.id as req_id, u.id, u.username, u.nickname, u.avatar, f.created_at
       FROM friends f
       JOIN users u ON u.id = f.user_id
       WHERE f.friend_id = ? AND f.status = 'pending'`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/friends/request — send friend request
router.post('/request', async (req, res, next) => {
  try {
    const { friend_id } = req.body;
    if (!friend_id || friend_id === req.user.id) return res.status(400).json({ error: 'Invalid friend_id' });
    const db = getDb();
    await db.query(
      `INSERT IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')`,
      [req.user.id, friend_id]
    );
    // Notify recipient via WebSocket if online
    const delivered = sendToUser(friend_id, { type: 'friend_request', from: req.user.id });
    // Push notification if offline
    if (!delivered) {
      const [senderRows] = await db.query('SELECT nickname, username FROM users WHERE id = ?', [req.user.id]);
      const senderName = senderRows[0]?.nickname || senderRows[0]?.username || 'Someone';
      const pushPayload = {
        type: 'friend_request',
        title: 'PaperPhone',
        body: `${senderName} sent you a friend request`,
        data: { type: 'friend_request', from: req.user.id },
      };
      pushToUser(friend_id, pushPayload).catch(() => {});
      pushToUserOneSignal(friend_id, pushPayload).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/friends/accept — accept a pending request
router.post('/accept', async (req, res, next) => {
  try {
    const { user_id } = req.body; // the requester
    const db = getDb();
    await db.query(
      `UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ? AND status = 'pending'`,
      [user_id, req.user.id]
    );
    // Create the reverse friendship
    await db.query(
      `INSERT IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted')`,
      [req.user.id, user_id]
    );
    sendToUser(user_id, { type: 'friend_accepted', by: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/friends/:id — remove friend
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    await db.query(
      `DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
      [req.user.id, req.params.id, req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/friends/:id/auto-delete — set auto-delete timer for private chat
router.patch('/:id/auto-delete', async (req, res, next) => {
  try {
    const allowed = [0, 86400, 259200, 604800, 2592000];
    const val = parseInt(req.body.auto_delete);
    if (!allowed.includes(val)) return res.status(400).json({ error: 'Invalid auto_delete value' });
    const db = getDb();
    // Update both directions of the friendship
    await db.query(
      `UPDATE friends SET auto_delete = ? WHERE
        (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
      [val, req.user.id, req.params.id, req.params.id, req.user.id]
    );
    // Notify the other party via WS
    sendToUser(req.params.id, {
      type: 'auto_delete_changed',
      chat_id: req.user.id,
      chat_type: 'private',
      auto_delete: val,
    });
    res.json({ ok: true, auto_delete: val });
  } catch (err) { next(err); }
});

module.exports = router;
