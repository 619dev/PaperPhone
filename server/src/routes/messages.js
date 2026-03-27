const express = require('express');
const { getDb } = require('../db/mysql');
const { authMiddleware } = require('../middlewares/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/messages/private/:partnerId?limit=50&before=<timestamp>
// Returns all stored messages (delivered + pending) between two users, newest last
router.get('/private/:partnerId', async (req, res, next) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = req.query.before ? new Date(parseInt(req.query.before)) : null;

    const [rows] = await db.query(
      `SELECT id, from_id, ciphertext, header, self_ciphertext, self_header, msg_type, created_at, read_at
       FROM messages
       WHERE type = 'private'
         AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
         ${before ? 'AND created_at < ?' : ''}
       ORDER BY created_at ASC
       LIMIT ?`,
      before
        ? [req.user.id, req.params.partnerId, req.params.partnerId, req.user.id, before, limit]
        : [req.user.id, req.params.partnerId, req.params.partnerId, req.user.id, limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/messages/group/:groupId?limit=50&before=<timestamp>
router.get('/group/:groupId', async (req, res, next) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = req.query.before ? new Date(parseInt(req.query.before)) : null;

    const [rows] = await db.query(
      `SELECT id, from_id, ciphertext, header, msg_type, created_at, read_at
       FROM messages
       WHERE type = 'group' AND to_id = ?
         ${before ? 'AND created_at < ?' : ''}
       ORDER BY created_at ASC
       LIMIT ?`,
      before
        ? [req.params.groupId, before, limit]
        : [req.params.groupId, limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
