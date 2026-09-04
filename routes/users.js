const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { requireAdmin } = require('./auth');
const { isSuperAdmin } = require('../lib/super-admin');

const router = express.Router();

// ── GET /api/users?q=  (admin) — search / list users ─────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const users = await db.searchUsers((req.query.q || '').trim());
    // flag protected owner accounts so the UI can hide destructive controls
    users.forEach(u => { u.is_super = isSuperAdmin(u.email); u.is_self = u.id === req.user.id; });
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
    const target = await db.findUserById(id);
    if (target && isSuperAdmin(target.email)) {
      return res.status(403).json({ error: 'บัญชีนี้เป็นผู้ดูแลระบบสูงสุด ไม่สามารถลบได้' });
    }
    const ok = await db.deleteUserById(id);
    if (!ok) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── PATCH /api/users/:id/role  (admin) — set role user|admin ──────────────────
router.patch('/:id/role', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  if (id === req.user.id) return res.status(400).json({ error: 'ไม่สามารถเปลี่ยนสิทธิ์ของตัวเองได้' });
  const role = String(req.body.role || '').trim();
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'role ไม่ถูกต้อง' });
  try {
    const target = await db.findUserById(id);
    if (target && isSuperAdmin(target.email) && role !== 'admin') {
      return res.status(403).json({ error: 'บัญชีนี้เป็นผู้ดูแลระบบสูงสุด ไม่สามารถลดสิทธิ์ได้' });
    }
    const ok = await db.setUserRole(id, role);
    if (!ok) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    res.json({ success: true, role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── POST /api/users/:id/reset-password  (admin) ──────────────────────────────
router.post('/:id/reset-password', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
  try {
    const target = await db.findUserById(id);
    if (target && isSuperAdmin(target.email) && id !== req.user.id) {
      return res.status(403).json({ error: 'บัญชีนี้เป็นผู้ดูแลระบบสูงสุด รีเซ็ตรหัสผ่านโดยผู้อื่นไม่ได้' });
    }
    const hashed = await bcrypt.hash(password, 12);
    const ok = await db.setUserPassword(id, hashed);
    if (!ok) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
