const express = require('express');
const { getDb } = require('../db/mysql');
const { authMiddleware } = require('../middlewares/auth');
const { getWsClients, sendToUser } = require('../ws/wsServer');

const router = express.Router();
router.use(authMiddleware);

// GET /api/friends — list accepted friends
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const [rows] = await db.query(
      `SELECT u.id, u.username, u.nickname, u.avatar, u.is_online, u.last_seen
       FROM friends f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = ? AND f.status = 'accepted'`,
      [req.user.id]
    );
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
    sendToUser(friend_id, { type: 'friend_request', from: req.user.id });
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

module.exports = router;
