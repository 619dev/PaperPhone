const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/mysql');
const { signToken } = require('../middlewares/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { username, nickname, password, ik_pub, spk_pub, spk_sig, kem_pub, prekeys } = req.body;
    if (!username || !password || !ik_pub || !spk_pub || !spk_sig || !kem_pub) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = getDb();
    const [existing] = await db.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    await db.query(
      `INSERT INTO users (id, username, nickname, password, ik_pub, spk_pub, spk_sig, kem_pub)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, username, nickname || username, hash, ik_pub, spk_pub, spk_sig, kem_pub]
    );

    // Upload one-time prekeys (OPKs)
    if (Array.isArray(prekeys) && prekeys.length > 0) {
      const rows = prekeys.map(pk => [id, pk.key_id, pk.opk_pub]);
      await db.query('INSERT INTO prekeys (user_id, key_id, opk_pub) VALUES ?', [rows]);
    }

    const token = signToken({ id, username });
    res.status(201).json({ token, user: { id, username, nickname: nickname || username } });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

    const db = getDb();
    const [rows] = await db.query(
      'SELECT id, username, nickname, avatar, password FROM users WHERE username = ?',
      [username]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    delete user.password;
    const token = signToken({ id: user.id, username: user.username });
    res.json({ token, user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
