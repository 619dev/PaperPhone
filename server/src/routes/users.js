const express = require('express');
const { getDb } = require('../db/mysql');
const { authMiddleware } = require('../middlewares/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/users/search?q=username
router.get('/search', async (req, res, next) => {
  try {
    const q = `%${req.query.q || ''}%`;
    const db = getDb();
    const [rows] = await db.query(
      `SELECT id, username, nickname, avatar FROM users
       WHERE username LIKE ? AND id != ?
       LIMIT 20`,
      [q, req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/users/me — current user profile
router.get('/me', async (req, res, next) => {
  try {
    const db = getDb();
    const [rows] = await db.query(
      'SELECT id, username, nickname, avatar, created_at, last_seen FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/users/me — update nickname or avatar
router.patch('/me', async (req, res, next) => {
  try {
    const { nickname, avatar } = req.body;
    const db = getDb();
    await db.query(
      'UPDATE users SET nickname = COALESCE(?, nickname), avatar = COALESCE(?, avatar) WHERE id = ?',
      [nickname || null, avatar || null, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/users/:id/prekeys — fetch X3DH prekey bundle for E2E handshake
router.get('/:id/prekeys', async (req, res, next) => {
  try {
    const db = getDb();
    const [users] = await db.query(
      'SELECT id, username, nickname, avatar, ik_pub, spk_pub, spk_sig, kem_pub FROM users WHERE id = ?',
      [req.params.id]
    );
    if (!users.length) return res.status(404).json({ error: 'User not found' });

    // Consume one OPK
    const [opks] = await db.query(
      'SELECT id, key_id, opk_pub FROM prekeys WHERE user_id = ? AND used = 0 LIMIT 1',
      [req.params.id]
    );
    let opk = null;
    if (opks.length) {
      opk = { key_id: opks[0].key_id, opk_pub: opks[0].opk_pub };
      await db.query('UPDATE prekeys SET used = 1 WHERE id = ?', [opks[0].id]);
    }

    res.json({ ...users[0], opk });
  } catch (err) { next(err); }
});

// POST /api/users/prekeys — replenish OPKs
router.post('/prekeys', async (req, res, next) => {
  try {
    const { prekeys } = req.body;
    if (!Array.isArray(prekeys) || !prekeys.length) return res.status(400).json({ error: 'No prekeys' });
    const db = getDb();
    const rows = prekeys.map(pk => [req.user.id, pk.key_id, pk.opk_pub]);
    await db.query('INSERT INTO prekeys (user_id, key_id, opk_pub) VALUES ?', [rows]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
