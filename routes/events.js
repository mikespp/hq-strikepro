const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAdmin } = require('./auth');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Constant-time string compare (avoids leaking the key via timing)
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Authorise a write from EITHER:
//   • the standalone Calendar Dashboard — header `X-Events-Key` matching
//     process.env.EVENTS_ADMIN_KEY (a shared password, decoupled from HQ login), OR
//   • a logged-in HQ admin (JWT via requireAdmin).
// If EVENTS_ADMIN_KEY is unset, only admin JWT is accepted (safe default).
function requireEventsWrite(req, res, next) {
  const key = process.env.EVENTS_ADMIN_KEY;
  const provided = req.get('X-Events-Key');
  if (key && provided && safeEqual(provided, key)) return next();
  return requireAdmin(req, res, next);
}

// Validate + normalise an incoming event payload. Returns { ok, data } or { ok:false, error }.
function parseEvent(body) {
  const title = (body.title || '').trim();
  const start = (body.start || '').trim();
  const end   = (body.end   || start).trim();
  const color = (body.color || '#d4af37').trim();
  const href  = body.href ? String(body.href).trim() : null;
  const live  = body.live === true || body.live === 1 || body.live === '1' || body.live === 'on';

  if (!title)                 return { ok: false, error: 'กรุณากรอกชื่อกิจกรรม' };
  if (!DATE_RE.test(start))   return { ok: false, error: 'วันเริ่มไม่ถูกต้อง (YYYY-MM-DD)' };
  if (!DATE_RE.test(end))     return { ok: false, error: 'วันสิ้นสุดไม่ถูกต้อง (YYYY-MM-DD)' };
  if (end < start)            return { ok: false, error: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม' };
  if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) return { ok: false, error: 'สีไม่ถูกต้อง (เช่น #d4af37)' };

  return { ok: true, data: { title, start, end, color, href: href || null, live } };
}

// ── GET /api/events  (public — homepage + dashboard read from here) ──────────
router.get('/', async (_req, res) => {
  try {
    res.json(await db.listEvents());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── GET /api/events/verify  — check the edit password (X-Events-Key) ─────────
router.get('/verify', requireEventsWrite, (_req, res) => res.json({ ok: true }));

// ── POST /api/events  (admin) ────────────────────────────────────────────────
router.post('/', requireEventsWrite, async (req, res) => {
  const parsed = parseEvent(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const event = await db.createEvent(parsed.data);
    res.status(201).json({ success: true, event });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── PUT /api/events/:id  (admin) ─────────────────────────────────────────────
router.put('/:id', requireEventsWrite, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const parsed = parseEvent(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const event = await db.updateEvent(id, parsed.data);
    if (!event) return res.status(404).json({ error: 'ไม่พบกิจกรรมนี้' });
    res.json({ success: true, event });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── DELETE /api/events/:id  (admin) ──────────────────────────────────────────
router.delete('/:id', requireEventsWrite, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const ok = await db.deleteEvent(id);
    if (!ok) return res.status(404).json({ error: 'ไม่พบกิจกรรมนี้' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
