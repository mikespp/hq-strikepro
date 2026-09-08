const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { requireAdmin, checkEligible } = require('./auth');
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

// ── POST /api/users/reverify  (admin) — backfill the StrikePro-customer flag ───
// Re-checks every unverified member against the live eligibility source (the
// synced local allowlist, and the remote check service if ELIGIBILITY_CHECK_URL
// is set), marking matches verified. Fixes members left verified=0 because the
// check was flaky at signup or they predate the allowlist.
router.post('/reverify', requireAdmin, async (req, res) => {
  try {
    // 1) fast path: local allowlist match in one query
    let updated = await db.refreshVerifiedFromEligible();
    // 2) if a remote check service is configured, re-check whoever is still 0
    if (process.env.ELIGIBILITY_CHECK_URL) {
      const pending = await db.listUnverifiedUsers();
      for (const u of pending) {
        try {
          if (await checkEligible(u.email)) { await db.setUserVerified(u.id, 1); updated++; }
        } catch { /* service hiccup — skip this one, keep going */ }
      }
    }
    res.json({ success: true, verified: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── PATCH /api/users/:id/verified  (admin) — manual override of the flag ───────
router.patch('/:id/verified', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const verified = req.body.verified ? 1 : 0;
  try {
    const ok = await db.setUserVerified(id, verified);
    if (!ok) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    res.json({ success: true, verified });
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

// ── Membership badge numbers ─────────────────────────────────────────────────
// GET /api/users/badges  (admin) — list all assigned badge numbers
router.get('/badges', requireAdmin, async (req, res) => {
  try { res.json(await db.listBadges()); }
  catch (err) { console.error(err); res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' }); }
});

// Parse pasted mapping text into { email, no } pairs. Accepts one pair per line,
// separated by comma / tab / spaces, in either order (email+number). Blank lines
// and a header row (email,badge) are skipped.
function parseBadgeText(text) {
  const isEmail = t => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
  const pairs = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[\s,;\t]+/).map(p => p.replace(/["']/g, '')).filter(Boolean);
    if (parts.length < 2) continue;
    let email = parts.find(isEmail);
    if (!email) continue;
    const no = parts.find(p => p !== email && /[0-9]/.test(p));
    if (no == null) continue;
    pairs.push({ email, no });
  }
  return pairs;
}

// POST /api/users/badges  (admin) — bulk assign. Body: { text } or { pairs:[{email,no}] }
router.post('/badges', requireAdmin, async (req, res) => {
  try {
    const pairs = Array.isArray(req.body.pairs) ? req.body.pairs : parseBadgeText(req.body.text);
    if (!pairs.length) return res.status(400).json({ error: 'ไม่พบข้อมูล email,เลข ที่อ่านได้' });
    const result = await db.bulkSetBadges(pairs);
    res.json({ success: true, parsed: pairs.length, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// PATCH /api/users/:id/badge  (admin) — set/clear one user's badge number
router.patch('/:id/badge', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const target = await db.findUserById(id);
    if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    const ok = await db.setBadgeByEmail(target.email, req.body.badge_no);
    res.json({ success: ok });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
