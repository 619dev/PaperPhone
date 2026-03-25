const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/mysql');
const { authMiddleware } = require('../middlewares/auth');
const { sendToUser, sendToGroup } = require('../ws/wsServer');

const router = express.Router();
router.use(authMiddleware);

// GET /api/groups — list my groups
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const [rows] = await db.query(
      `SELECT g.id, g.name, g.avatar, g.notice, g.owner_id, gm.role
       FROM group_members gm
       JOIN \`groups\` g ON g.id = gm.group_id
       WHERE gm.user_id = ?`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/groups — create group
router.post('/', async (req, res, next) => {
  try {
    const { name, member_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name required' });
    const db = getDb();
    const id = uuidv4();
    await db.query(
      `INSERT INTO \`groups\` (id, name, owner_id) VALUES (?, ?, ?)`,
      [id, name, req.user.id]
    );
    // Add owner + initial members
    const members = [...new Set([req.user.id, ...(member_ids || [])])];
    const rows = members.map(uid => [id, uid, uid === req.user.id ? 'owner' : 'member']);
    await db.query('INSERT INTO group_members (group_id, user_id, role) VALUES ?', [rows]);
    res.status(201).json({ id, name, owner_id: req.user.id });
  } catch (err) { next(err); }
});

// GET /api/groups/:id — group info + members
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const [groups] = await db.query('SELECT * FROM `groups` WHERE id = ?', [req.params.id]);
    if (!groups.length) return res.status(404).json({ error: 'Group not found' });
    const [members] = await db.query(
      `SELECT u.id, u.username, u.nickname, u.avatar, gm.role FROM group_members gm
       JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?`,
      [req.params.id]
    );
    res.json({ ...groups[0], members });
  } catch (err) { next(err); }
});

// POST /api/groups/:id/members — add member
router.post('/:id/members', async (req, res, next) => {
  try {
    const { user_id } = req.body;
    const db = getDb();
    await db.query(
      `INSERT IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')`,
      [req.params.id, user_id]
    );
    sendToGroup(req.params.id, { type: 'group_member_added', group_id: req.params.id, user_id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/groups/:id/members/:uid — remove member (owner/admin only simplified)
router.delete('/:id/members/:uid', async (req, res, next) => {
  try {
    const db = getDb();
    await db.query(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.params.uid]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
