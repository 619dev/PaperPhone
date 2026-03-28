/**
 * Friend Tags API
 *
 * GET    /api/tags              — list all tags for current user
 * POST   /api/tags              — create a tag
 * PATCH  /api/tags/:id          — update tag name/color
 * DELETE /api/tags/:id          — delete a tag
 * GET    /api/tags/:id/friends  — list friends under a tag
 * POST   /api/tags/:id/friends  — assign friends to a tag
 * DELETE /api/tags/:id/friends/:friendId — remove friend from tag
 */
const express = require('express');
const { getDb } = require('../db/mysql');
const { authMiddleware } = require('../middlewares/auth');

const router = express.Router();
router.use(authMiddleware);

// ── Init tables (called once on server start) ─────────────────────────────
async function initTagTables() {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS friend_tags (
      id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id     VARCHAR(36)   NOT NULL,
      name        VARCHAR(32)   NOT NULL,
      color       VARCHAR(7)    DEFAULT '#2196F3',
      created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_tag (user_id, name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_ft_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS friend_tag_assignments (
      tag_id      BIGINT UNSIGNED NOT NULL,
      friend_id   VARCHAR(36)     NOT NULL,
      PRIMARY KEY (tag_id, friend_id),
      FOREIGN KEY (tag_id)    REFERENCES friend_tags(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES users(id)       ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ Tag tables ready');
}

// ── GET /api/tags — list all tags with friend counts ──────────────────────
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const [rows] = await db.query(
      `SELECT t.id, t.name, t.color, t.created_at,
              COUNT(a.friend_id) as friend_count
       FROM friend_tags t
       LEFT JOIN friend_tag_assignments a ON a.tag_id = t.id
       WHERE t.user_id = ?
       GROUP BY t.id
       ORDER BY t.created_at ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/tags — create a new tag ─────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { name, color = '#2196F3' } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Tag name required' });
    if (name.trim().length > 32) return res.status(400).json({ error: 'Tag name too long (max 32)' });

    const db = getDb();
    // Check max tags per user (limit 50)
    const [existing] = await db.query(
      'SELECT COUNT(*) as cnt FROM friend_tags WHERE user_id = ?', [req.user.id]
    );
    if (existing[0].cnt >= 50) return res.status(400).json({ error: 'Max 50 tags' });

    const [r] = await db.query(
      'INSERT INTO friend_tags (user_id, name, color) VALUES (?, ?, ?)',
      [req.user.id, name.trim(), color]
    );
    res.json({ id: r.insertId, name: name.trim(), color });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Tag already exists' });
    next(err);
  }
});

// ── PATCH /api/tags/:id — update tag name/color ───────────────────────────
router.patch('/:id', async (req, res, next) => {
  try {
    const { name, color } = req.body;
    const db = getDb();

    // Verify ownership
    const [tag] = await db.query(
      'SELECT id FROM friend_tags WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!tag.length) return res.status(404).json({ error: 'Tag not found' });

    const updates = [];
    const params = [];
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'Tag name required' });
      updates.push('name = ?');
      params.push(name.trim());
    }
    if (color !== undefined) {
      updates.push('color = ?');
      params.push(color);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.params.id, req.user.id);
    await db.query(
      `UPDATE friend_tags SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Tag name already exists' });
    next(err);
  }
});

// ── DELETE /api/tags/:id — delete a tag ───────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const [r] = await db.query(
      'DELETE FROM friend_tags WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Tag not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/tags/:id/friends — list friends under a tag ──────────────────
router.get('/:id/friends', async (req, res, next) => {
  try {
    const db = getDb();
    // Verify ownership
    const [tag] = await db.query(
      'SELECT id FROM friend_tags WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!tag.length) return res.status(404).json({ error: 'Tag not found' });

    const [rows] = await db.query(
      `SELECT u.id, u.username, u.nickname, u.avatar, u.is_online
       FROM friend_tag_assignments a
       JOIN users u ON u.id = a.friend_id
       WHERE a.tag_id = ?`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/tags/:id/friends — assign friends to a tag ──────────────────
router.post('/:id/friends', async (req, res, next) => {
  try {
    const { friend_ids } = req.body;
    if (!Array.isArray(friend_ids) || !friend_ids.length) {
      return res.status(400).json({ error: 'friend_ids array required' });
    }
    const db = getDb();

    // Verify ownership
    const [tag] = await db.query(
      'SELECT id FROM friend_tags WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!tag.length) return res.status(404).json({ error: 'Tag not found' });

    // Verify all are actual friends
    const placeholders = friend_ids.map(() => '?').join(',');
    const [friends] = await db.query(
      `SELECT friend_id FROM friends
       WHERE user_id = ? AND friend_id IN (${placeholders}) AND status = 'accepted'`,
      [req.user.id, ...friend_ids]
    );
    const validIds = friends.map(f => f.friend_id);

    // Batch insert (ignore duplicates)
    for (const fid of validIds) {
      await db.query(
        'INSERT IGNORE INTO friend_tag_assignments (tag_id, friend_id) VALUES (?, ?)',
        [req.params.id, fid]
      );
    }
    res.json({ ok: true, added: validIds.length });
  } catch (err) { next(err); }
});

// ── DELETE /api/tags/:id/friends/:friendId — remove friend from tag ───────
router.delete('/:id/friends/:friendId', async (req, res, next) => {
  try {
    const db = getDb();
    // Verify ownership
    const [tag] = await db.query(
      'SELECT id FROM friend_tags WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!tag.length) return res.status(404).json({ error: 'Tag not found' });

    await db.query(
      'DELETE FROM friend_tag_assignments WHERE tag_id = ? AND friend_id = ?',
      [req.params.id, req.params.friendId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.initTagTables = initTagTables;
