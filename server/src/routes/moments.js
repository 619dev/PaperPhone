/**
 * Moments (朋友圈) API
 *
 * POST   /api/moments          — create a moment (text + image URLs + visibility)
 * GET    /api/moments          — feed (own + friends), paginated, visibility-filtered
 * GET    /api/moments/:id      — single moment
 * DELETE /api/moments/:id      — delete own moment
 * POST   /api/moments/:id/like — toggle like
 * GET    /api/moments/:id/comments — list comments
 * POST   /api/moments/:id/comments — add comment
 * DELETE /api/moments/:momentId/comments/:commentId — delete own comment
 */
const express = require('express');
const { authMiddleware } = require('../middlewares/auth');
const { getDb } = require('../db/mysql');

const router = express.Router();
router.use(authMiddleware);

// ── Init tables (called once on server start) ─────────────────────────────
async function initMomentsTables() {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS moments (
      id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id     VARCHAR(36)     NOT NULL,
      text_content VARCHAR(1024)  NOT NULL DEFAULT '',
      visibility  ENUM('public','whitelist','blacklist') NOT NULL DEFAULT 'public',
      created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_created_at (created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS moment_images (
      id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      moment_id   BIGINT UNSIGNED NOT NULL,
      url         TEXT            NOT NULL,
      sort_order  TINYINT UNSIGNED NOT NULL DEFAULT 0,
      INDEX idx_moment_id (moment_id),
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS moment_likes (
      id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      moment_id   BIGINT UNSIGNED NOT NULL,
      user_id     VARCHAR(36)     NOT NULL,
      created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_like (moment_id, user_id),
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS moment_comments (
      id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      moment_id   BIGINT UNSIGNED NOT NULL,
      user_id     VARCHAR(36)     NOT NULL,
      text_content VARCHAR(512)  NOT NULL,
      created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_moment_id (moment_id),
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS moment_visibility (
      moment_id   BIGINT UNSIGNED NOT NULL,
      type        ENUM('whitelist','blacklist') NOT NULL,
      target_type ENUM('tag','user') NOT NULL,
      target_id   VARCHAR(36) NOT NULL,
      PRIMARY KEY (moment_id, target_type, target_id),
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // Idempotent migration: add visibility column
  try {
    await db.query(`
      ALTER TABLE moments ADD COLUMN visibility ENUM('public','whitelist','blacklist') NOT NULL DEFAULT 'public' AFTER text_content
    `);
  } catch (e) {
    // Column already exists — ignore
    if (!e.message.includes('Duplicate column')) throw e;
  }
  console.log('✅ Moments tables ready');
}

module.exports = router;
module.exports.initMomentsTables = initMomentsTables;

// ── Helper: enrich moment rows with user info, likes, comments ─────────────
async function enrichMoments(moments, viewerUserId) {
  if (!moments.length) return [];
  const db = getDb();
  const ids = moments.map(m => m.id);
  const placeholders = ids.map(() => '?').join(',');

  // Images
  const [imgs] = await db.query(
    `SELECT moment_id, url, sort_order FROM moment_images WHERE moment_id IN (${placeholders}) ORDER BY moment_id, sort_order`,
    ids
  );
  // Likes counts + whether viewer liked
  const [likes] = await db.query(
    `SELECT moment_id, COUNT(*) as cnt,
      SUM(user_id = ?) as viewer_liked
     FROM moment_likes WHERE moment_id IN (${placeholders}) GROUP BY moment_id`,
    [viewerUserId, ...ids]
  );
  // Liked users (up to 20 per moment with avatars)
  const [likedUsers] = await db.query(
    `SELECT ml.moment_id, u.id, u.nickname, u.username, u.avatar
     FROM moment_likes ml
     JOIN users u ON u.id = ml.user_id
     WHERE ml.moment_id IN (${placeholders})
     ORDER BY ml.moment_id, ml.created_at ASC`,
    ids
  );
  // Comments (with user info)
  const [comments] = await db.query(
    `SELECT mc.id, mc.moment_id, mc.user_id, mc.text_content, mc.created_at,
            u.nickname, u.username, u.avatar
     FROM moment_comments mc
     JOIN users u ON u.id = mc.user_id
     WHERE mc.moment_id IN (${placeholders})
     ORDER BY mc.moment_id, mc.created_at ASC`,
    ids
  );

  const imgMap = {};
  imgs.forEach(r => { (imgMap[r.moment_id] = imgMap[r.moment_id] || []).push(r.url); });
  const likeMap = {};
  likes.forEach(r => { likeMap[r.moment_id] = { cnt: Number(r.cnt), viewerLiked: !!r.viewer_liked }; });
  const likedUserMap = {};
  likedUsers.forEach(r => {
    if (!likedUserMap[r.moment_id]) likedUserMap[r.moment_id] = [];
    if (likedUserMap[r.moment_id].length < 20) {
      likedUserMap[r.moment_id].push({ id: r.id, nickname: r.nickname, username: r.username, avatar: r.avatar });
    }
  });
  const cmtMap = {};
  comments.forEach(r => { (cmtMap[r.moment_id] = cmtMap[r.moment_id] || []).push(r); });

  return moments.map(m => ({
    ...m,
    images: imgMap[m.id] || [],
    likes: (likeMap[m.id] || {}).cnt || 0,
    viewerLiked: (likeMap[m.id] || {}).viewerLiked || false,
    likedUsers: likedUserMap[m.id] || [],
    comments: cmtMap[m.id] || [],
  }));
}

// ── POST /api/moments ─────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const {
      text = '', images = [],
      visibility = 'public',
      visible_tags = [], visible_users = [],
      invisible_tags = [], invisible_users = []
    } = req.body;

    if (text.length > 1024) return res.status(400).json({ error: 'Text too long (max 1024)' });
    if (!Array.isArray(images) || images.length > 9) return res.status(400).json({ error: 'Max 9 images' });
    if (!text.trim() && images.length === 0) return res.status(400).json({ error: 'Text or images required' });
    if (!['public', 'whitelist', 'blacklist'].includes(visibility)) {
      return res.status(400).json({ error: 'Invalid visibility' });
    }

    const db = getDb();
    const [r] = await db.query(
      'INSERT INTO moments (user_id, text_content, visibility) VALUES (?,?,?)',
      [req.user.id, text.trim(), visibility]
    );
    const momentId = r.insertId;

    // Insert images
    for (let i = 0; i < images.length; i++) {
      await db.query(
        'INSERT INTO moment_images (moment_id, url, sort_order) VALUES (?,?,?)',
        [momentId, images[i], i]
      );
    }

    // Insert visibility rules
    if (visibility === 'whitelist') {
      for (const tagId of visible_tags) {
        await db.query(
          'INSERT IGNORE INTO moment_visibility (moment_id, type, target_type, target_id) VALUES (?,?,?,?)',
          [momentId, 'whitelist', 'tag', String(tagId)]
        );
      }
      for (const userId of visible_users) {
        await db.query(
          'INSERT IGNORE INTO moment_visibility (moment_id, type, target_type, target_id) VALUES (?,?,?,?)',
          [momentId, 'whitelist', 'user', userId]
        );
      }
    } else if (visibility === 'blacklist') {
      for (const tagId of invisible_tags) {
        await db.query(
          'INSERT IGNORE INTO moment_visibility (moment_id, type, target_type, target_id) VALUES (?,?,?,?)',
          [momentId, 'blacklist', 'tag', String(tagId)]
        );
      }
      for (const userId of invisible_users) {
        await db.query(
          'INSERT IGNORE INTO moment_visibility (moment_id, type, target_type, target_id) VALUES (?,?,?,?)',
          [momentId, 'blacklist', 'user', userId]
        );
      }
    }

    res.json({ id: momentId });
  } catch (err) { next(err); }
});

// ── GET /api/moments ──────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const before = req.query.before ? new Date(req.query.before) : null;
    const viewerId = req.user.id;

    // Feed = own moments + friends' moments (with visibility filtering)
    // Step 1: Get candidate moments (own + friends)
    const [rows] = await db.query(
      `SELECT m.id, m.user_id, m.text_content, m.visibility, m.created_at,
              u.nickname, u.username, u.avatar
       FROM moments m
       JOIN users u ON u.id = m.user_id
       WHERE (m.user_id = ?
              OR m.user_id IN (
                SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END
                FROM friends WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'
              ))
       ${before ? 'AND m.created_at < ?' : ''}
       ORDER BY m.created_at DESC
       LIMIT ?`,
      before
        ? [viewerId, viewerId, viewerId, viewerId, before, limit * 2]
        : [viewerId, viewerId, viewerId, viewerId, limit * 2]
    );

    // Step 2: Filter by visibility rules
    const filtered = [];
    for (const m of rows) {
      if (filtered.length >= limit) break;

      // Own moments always visible
      if (m.user_id === viewerId) {
        filtered.push(m);
        continue;
      }

      if (m.visibility === 'public') {
        filtered.push(m);
        continue;
      }

      // Check visibility rules for this moment
      const [rules] = await db.query(
        'SELECT type, target_type, target_id FROM moment_visibility WHERE moment_id = ?',
        [m.id]
      );

      if (m.visibility === 'whitelist') {
        // Viewer must be in whitelist (directly or via tag)
        let allowed = false;
        for (const rule of rules) {
          if (rule.target_type === 'user' && rule.target_id === viewerId) {
            allowed = true;
            break;
          }
          if (rule.target_type === 'tag') {
            // Check if viewer is assigned to this tag (owned by the poster)
            const [tagCheck] = await db.query(
              `SELECT 1 FROM friend_tag_assignments a
               JOIN friend_tags t ON t.id = a.tag_id
               WHERE a.tag_id = ? AND a.friend_id = ? AND t.user_id = ?`,
              [rule.target_id, viewerId, m.user_id]
            );
            if (tagCheck.length) { allowed = true; break; }
          }
        }
        if (allowed) filtered.push(m);
      } else if (m.visibility === 'blacklist') {
        // Viewer must NOT be in blacklist
        let blocked = false;
        for (const rule of rules) {
          if (rule.target_type === 'user' && rule.target_id === viewerId) {
            blocked = true;
            break;
          }
          if (rule.target_type === 'tag') {
            const [tagCheck] = await db.query(
              `SELECT 1 FROM friend_tag_assignments a
               JOIN friend_tags t ON t.id = a.tag_id
               WHERE a.tag_id = ? AND a.friend_id = ? AND t.user_id = ?`,
              [rule.target_id, viewerId, m.user_id]
            );
            if (tagCheck.length) { blocked = true; break; }
          }
        }
        if (!blocked) filtered.push(m);
      }
    }

    const enriched = await enrichMoments(filtered, viewerId);
    res.json(enriched);
  } catch (err) { next(err); }
});

// ── DELETE /api/moments/:id ───────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const [rows] = await db.query('SELECT user_id FROM moments WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await db.query('DELETE FROM moment_visibility WHERE moment_id=?', [req.params.id]);
    await db.query('DELETE FROM moment_images WHERE moment_id=?', [req.params.id]);
    await db.query('DELETE FROM moment_likes WHERE moment_id=?', [req.params.id]);
    await db.query('DELETE FROM moment_comments WHERE moment_id=?', [req.params.id]);
    await db.query('DELETE FROM moments WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/moments/:id/like ────────────────────────────────────────────
router.post('/:id/like', async (req, res, next) => {
  try {
    const db = getDb();
    const [existing] = await db.query(
      'SELECT id FROM moment_likes WHERE moment_id=? AND user_id=?',
      [req.params.id, req.user.id]
    );
    if (existing.length) {
      await db.query('DELETE FROM moment_likes WHERE moment_id=? AND user_id=?', [req.params.id, req.user.id]);
      res.json({ liked: false });
    } else {
      await db.query('INSERT INTO moment_likes (moment_id, user_id) VALUES (?,?)', [req.params.id, req.user.id]);
      res.json({ liked: true });
    }
  } catch (err) { next(err); }
});

// ── POST /api/moments/:id/comments ───────────────────────────────────────
router.post('/:id/comments', async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
    if (text.length > 512) return res.status(400).json({ error: 'Comment too long (max 512)' });
    const db = getDb();
    const [r] = await db.query(
      'INSERT INTO moment_comments (moment_id, user_id, text_content) VALUES (?,?,?)',
      [req.params.id, req.user.id, text.trim()]
    );
    res.json({ id: r.insertId, text: text.trim(), user_id: req.user.id });
  } catch (err) { next(err); }
});

// ── DELETE /api/moments/:momentId/comments/:commentId ────────────────────
router.delete('/:momentId/comments/:commentId', async (req, res, next) => {
  try {
    const db = getDb();
    const [rows] = await db.query('SELECT user_id FROM moment_comments WHERE id=?', [req.params.commentId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await db.query('DELETE FROM moment_comments WHERE id=?', [req.params.commentId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
