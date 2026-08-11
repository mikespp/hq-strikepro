const express = require('express');
const db      = require('../db/database');
const { requireAdmin } = require('./auth');

const router = express.Router();

// ── GET /api/users?q=  (admin) — search / list users ─────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const users = await db.searchUsers((req.query.q || '').trim());
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── DELETE /api/users/:id  (admin) ───────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  if (id === req.user.id) {
    return res.status(400).json({ error: 'ไม่สามารถลบบัญชีของตัวเองได้' });
  }
  try {
    const ok = await db.deleteUserById(id);
    if (!ok) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
