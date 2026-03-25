const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/mysql');
const { authMiddleware } = require('../middlewares/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/messages/private/:partnerId — fetch offline messages (delivered messages are purged)
router.get('/private/:partnerId', async (req, res, next) => {
  try {
    const db = getDb();
    const [rows] = await db.query(
      `SELECT id, from_id, ciphertext, header, msg_type, created_at
       FROM messages
       WHERE type = 'private'
         AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
       ORDER BY created_at ASC
       LIMIT 100`,
      [req.user.id, req.params.partnerId, req.params.partnerId, req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/messages/group/:groupId — fetch group messages
router.get('/group/:groupId', async (req, res, next) => {
  try {
    const db = getDb();
    const [rows] = await db.query(
      `SELECT id, from_id, ciphertext, header, msg_type, created_at
       FROM messages
       WHERE type = 'group' AND to_id = ?
       ORDER BY created_at ASC
       LIMIT 100`,
      [req.params.groupId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
