const express = require('express');
const { getDb } = require('../db/mysql');
const { authMiddleware } = require('../middlewares/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/messages/private/:partnerId?limit=50&before=<timestamp>
// Returns the LATEST stored messages between two users, ordered oldest→newest for display.
// Uses a subquery to pick the most recent N rows (DESC), then re-orders ASC.
router.get('/private/:partnerId', async (req, res, next) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = req.query.before ? new Date(parseInt(req.query.before)) : null;

    const [rows] = await db.query(
      `SELECT * FROM (
         SELECT id, from_id, ciphertext, header, self_ciphertext, self_header, msg_type, created_at, read_at
         FROM messages
         WHERE type = 'private'
           AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
           ${before ? 'AND created_at < ?' : ''}
         ORDER BY created_at DESC
         LIMIT ?
       ) AS recent ORDER BY created_at ASC`,
      before
        ? [req.user.id, req.params.partnerId, req.params.partnerId, req.user.id, before, limit]
        : [req.user.id, req.params.partnerId, req.params.partnerId, req.user.id, limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/messages/group/:groupId?limit=50&before=<timestamp>
// Returns the LATEST group messages, ordered oldest→newest for display.
router.get('/group/:groupId', async (req, res, next) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = req.query.before ? new Date(parseInt(req.query.before)) : null;

    const [rows] = await db.query(
      `SELECT * FROM (
         SELECT m.id, m.from_id, m.ciphertext, m.header, m.msg_type, m.created_at, m.read_at,
                u.nickname AS from_nickname, u.avatar AS from_avatar
         FROM messages m
         LEFT JOIN users u ON u.id = m.from_id
         WHERE m.type = 'group' AND m.to_id = ?
           ${before ? 'AND m.created_at < ?' : ''}
         ORDER BY m.created_at DESC
         LIMIT ?
       ) AS recent ORDER BY created_at ASC`,
      before
        ? [req.params.groupId, before, limit]
        : [req.params.groupId, limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
