const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/mysql');
const { authMiddleware } = require('../middlewares/auth');
const { sendToUser, sendToGroup } = require('../ws/wsServer');

const router = express.Router();
router.use(authMiddleware);

const MAX_GROUP_MEMBERS = 2000;

// GET /api/groups — list my groups
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const [rows] = await db.query(
      `SELECT g.id, g.name, g.avatar, g.notice, g.owner_id, g.auto_delete, gm.role, gm.muted,
              (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
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
    const members = [...new Set([req.user.id, ...(member_ids || [])])];
    if (members.length > MAX_GROUP_MEMBERS) {
      return res.status(400).json({ error: `Group cannot exceed ${MAX_GROUP_MEMBERS} members` });
    }
    const db = getDb();
    const id = uuidv4();
    await db.query(
      `INSERT INTO \`groups\` (id, name, owner_id) VALUES (?, ?, ?)`,
      [id, name, req.user.id]
    );
    const rows = members.map(uid => [id, uid, uid === req.user.id ? 'owner' : 'member']);
    await db.query('INSERT INTO group_members (group_id, user_id, role) VALUES ?', [rows]);

    const group = { id, name, owner_id: req.user.id, member_count: members.length };

    // Notify added members via WS
    for (const uid of members) {
      if (uid !== req.user.id) {
        sendToUser(uid, { type: 'group_created', group });
      }
    }

    res.status(201).json(group);
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
       JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?
       ORDER BY FIELD(gm.role, 'owner', 'admin', 'member'), gm.joined_at ASC`,
      [req.params.id]
    );
    res.json({ ...groups[0], members, member_count: members.length });
  } catch (err) { next(err); }
});

// PATCH /api/groups/:id — update group name / avatar / notice
router.patch('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    // Check caller is owner or admin
    const [roleRows] = await db.query(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!roleRows.length || !['owner', 'admin'].includes(roleRows[0].role)) {
      return res.status(403).json({ error: 'Only owner or admin can update group' });
    }
    const updates = [];
    const vals = [];
    if (req.body.name) { updates.push('name = ?'); vals.push(req.body.name); }
    if (req.body.avatar !== undefined) { updates.push('avatar = ?'); vals.push(req.body.avatar); }
    if (req.body.notice !== undefined) { updates.push('notice = ?'); vals.push(req.body.notice); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await db.query(`UPDATE \`groups\` SET ${updates.join(', ')} WHERE id = ?`, vals);
    await sendToGroup(req.params.id, {
      type: 'group_updated', group_id: req.params.id,
      name: req.body.name, avatar: req.body.avatar, notice: req.body.notice,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/groups/:id/members — add member
router.post('/:id/members', async (req, res, next) => {
  try {
    const { user_id } = req.body;
    const db = getDb();
    // Check member count
    const [countRows] = await db.query(
      'SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = ?',
      [req.params.id]
    );
    if (countRows[0].cnt >= MAX_GROUP_MEMBERS) {
      return res.status(400).json({ error: `Group cannot exceed ${MAX_GROUP_MEMBERS} members` });
    }
    await db.query(
      `INSERT IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')`,
      [req.params.id, user_id]
    );
    // Fetch group info to notify the new member
    const [groups] = await db.query('SELECT id, name, avatar FROM `groups` WHERE id = ?', [req.params.id]);
    sendToUser(user_id, { type: 'group_created', group: groups[0] });
    sendToGroup(req.params.id, { type: 'group_member_added', group_id: req.params.id, user_id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/groups/:id/members/me — leave group
router.delete('/:id/members/me', async (req, res, next) => {
  try {
    const db = getDb();
    const [roleRows] = await db.query(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!roleRows.length) return res.status(404).json({ error: 'Not in this group' });
    if (roleRows[0].role === 'owner') {
      return res.status(400).json({ error: 'Owner cannot leave. Transfer ownership or disband the group.' });
    }
    await db.query(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    await sendToGroup(req.params.id, {
      type: 'group_member_removed', group_id: req.params.id, user_id: req.user.id,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/groups/:id/members/:uid — remove member (owner/admin only)
router.delete('/:id/members/:uid', async (req, res, next) => {
  try {
    const db = getDb();
    // Check caller is owner or admin
    const [roleRows] = await db.query(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!roleRows.length || !['owner', 'admin'].includes(roleRows[0].role)) {
      return res.status(403).json({ error: 'Only owner or admin can remove members' });
    }
    await db.query(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.params.uid]
    );
    sendToUser(req.params.uid, {
      type: 'group_member_removed', group_id: req.params.id, user_id: req.params.uid,
    });
    await sendToGroup(req.params.id, {
      type: 'group_member_removed', group_id: req.params.id, user_id: req.params.uid,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/groups/:id — disband group (owner only)
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const [groups] = await db.query('SELECT owner_id FROM `groups` WHERE id = ?', [req.params.id]);
    if (!groups.length) return res.status(404).json({ error: 'Group not found' });
    if (groups[0].owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the owner can disband the group' });
    }
    await sendToGroup(req.params.id, { type: 'group_disbanded', group_id: req.params.id });
    await db.query('DELETE FROM `groups` WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/groups/:id/auto-delete — set auto-delete timer (owner only)
router.patch('/:id/auto-delete', async (req, res, next) => {
  try {
    const allowed = [0, 86400, 259200, 604800, 2592000];
    const val = parseInt(req.body.auto_delete);
    if (!allowed.includes(val)) return res.status(400).json({ error: 'Invalid auto_delete value' });
    const db = getDb();
    const [groups] = await db.query('SELECT owner_id FROM `groups` WHERE id = ?', [req.params.id]);
    if (!groups.length) return res.status(404).json({ error: 'Group not found' });
    if (groups[0].owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the owner can set auto-delete' });
    }
    await db.query('UPDATE `groups` SET auto_delete = ? WHERE id = ?', [val, req.params.id]);
    await sendToGroup(req.params.id, {
      type: 'auto_delete_changed',
      chat_id: req.params.id,
      chat_type: 'group',
      auto_delete: val,
    });
    res.json({ ok: true, auto_delete: val });
  } catch (err) { next(err); }
});

// PATCH /api/groups/:id/mute — toggle mute (any member)
router.patch('/:id/mute', async (req, res, next) => {
  try {
    const db = getDb();
    const muted = req.body.muted ? 1 : 0;
    await db.query(
      'UPDATE group_members SET muted = ? WHERE group_id = ? AND user_id = ?',
      [muted, req.params.id, req.user.id]
    );
    res.json({ ok: true, muted });
  } catch (err) { next(err); }
});

// ── Group Invite QR Codes ──────────────────────────────────────────────────

// POST /api/groups/:id/invite — create invite link (owner/admin only)
router.post('/:id/invite', async (req, res, next) => {
  try {
    const db = getDb();
    // Ensure group_invites table exists (idempotent)
    await db.query(`
      CREATE TABLE IF NOT EXISTS group_invites (
        id          VARCHAR(36)   PRIMARY KEY,
        group_id    VARCHAR(36)   NOT NULL,
        created_by  VARCHAR(36)   NOT NULL,
        expires_at  DATETIME      NOT NULL,
        created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_gi_group (group_id),
        INDEX idx_gi_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Check caller is owner or admin
    const [roleRows] = await db.query(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!roleRows.length || !['owner', 'admin'].includes(roleRows[0].role)) {
      return res.status(403).json({ error: 'Only owner or admin can create invites' });
    }
    const durationMap = { '1w': 7, '1m': 30, '3m': 90 };
    const days = durationMap[req.body.duration] || 7;
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + days * 86400000);
    await db.query(
      'INSERT INTO group_invites (id, group_id, created_by, expires_at) VALUES (?, ?, ?, ?)',
      [id, req.params.id, req.user.id, expiresAt]
    );
    res.status(201).json({ invite_id: id, expires_at: expiresAt.toISOString() });
  } catch (err) { next(err); }
});

// GET /api/groups/invite/:invite_id — get invite info
router.get('/invite/:invite_id', async (req, res, next) => {
  try {
    const db = getDb();
    const [rows] = await db.query(
      `SELECT gi.id, gi.group_id, gi.expires_at, g.name, g.avatar,
              (SELECT COUNT(*) FROM group_members WHERE group_id = gi.group_id) AS member_count
       FROM group_invites gi
       JOIN \`groups\` g ON g.id = gi.group_id
       WHERE gi.id = ?`,
      [req.params.invite_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invite not found' });
    const invite = rows[0];
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite expired', expired: true });
    }
    res.json({
      invite_id: invite.id,
      group_id: invite.group_id,
      group_name: invite.name,
      group_avatar: invite.avatar,
      member_count: invite.member_count,
      expires_at: invite.expires_at,
    });
  } catch (err) { next(err); }
});

// POST /api/groups/invite/:invite_id/join — join group via invite
router.post('/invite/:invite_id/join', async (req, res, next) => {
  try {
    const db = getDb();
    const [rows] = await db.query(
      'SELECT * FROM group_invites WHERE id = ?',
      [req.params.invite_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invite not found' });
    const invite = rows[0];
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite expired', expired: true });
    }
    // Check if already a member
    const [memberCheck] = await db.query(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [invite.group_id, req.user.id]
    );
    if (memberCheck.length) {
      return res.status(400).json({ error: 'Already a member', already_member: true });
    }
    // Check member count
    const [countRows] = await db.query(
      'SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = ?',
      [invite.group_id]
    );
    if (countRows[0].cnt >= MAX_GROUP_MEMBERS) {
      return res.status(400).json({ error: `Group cannot exceed ${MAX_GROUP_MEMBERS} members` });
    }
    // Add member
    await db.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')`,
      [invite.group_id, req.user.id]
    );
    // Fetch group info
    const [groups] = await db.query('SELECT id, name, avatar FROM `groups` WHERE id = ?', [invite.group_id]);
    const group = groups[0];
    // Notify existing members
    sendToGroup(invite.group_id, { type: 'group_member_added', group_id: invite.group_id, user_id: req.user.id });
    res.json({ ok: true, group });
  } catch (err) { next(err); }
});

module.exports = router;
