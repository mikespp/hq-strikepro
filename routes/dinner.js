const express = require('express');
const db      = require('../db/database');
const { requireAdmin } = require('./auth');

const router = express.Router();

// กินข้าวบ้านจารย์ "rounds" live in dinner_editions (date/time/venue only, no seats).
// The active round = the highest round number. The public page never shows the
// round number; the admin does.
async function activeCfg() {
  const row = await db.getActiveDinnerEdition();
  if (!row) return null;
  return {
    round:      row.round,
    label:      'รอบที่ ' + row.round,
    eventStart: new Date(row.event_start),
    eventEnd:   new Date(row.event_end),
    venue:      row.venue,
  };
}

function statusOf(cfg) {
  if (!cfg) return null;
  const now = new Date();
  return {
    round:      cfg.round,          // admin-only info; the public page ignores it
    label:      cfg.label,
    eventStart: cfg.eventStart.toISOString(),
    eventEnd:   cfg.eventEnd.toISOString(),
    venue:      cfg.venue,
    ended:      now >= cfg.eventEnd,
  };
}

// Validate + normalise the round form (date/start/end/venue). No seats.
function parseInput(b) {
  b = b || {};
  const date  = String(b.date  || '').trim();
  const start = String(b.start || '').trim();
  const end   = String(b.end   || '').trim();
  const venue = String(b.venue || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'กรุณาเลือกวันที่ให้ถูกต้อง' };
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end))
    return { error: 'กรุณากรอกเวลาให้ถูกต้อง (HH:MM)' };
  if (!venue) return { error: 'กรุณากรอกสถานที่' };
  const event_start = `${date}T${start}:00+07:00`;
  const event_end   = `${date}T${end}:00+07:00`;
  const sd = new Date(event_start), ed = new Date(event_end);
  if (isNaN(sd) || isNaN(ed)) return { error: 'วัน/เวลาไม่ถูกต้อง' };
  if (ed <= sd)               return { error: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม' };
  return { event_start, event_end, venue, dateYMD: date };
}

// ── GET /api/dinner/status  (public) — active round's date/time/venue ─────────
router.get('/status', async (req, res) => {
  try {
    const cfg = await activeCfg();
    res.json(cfg ? statusOf(cfg) : { round: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── GET /api/dinner/admin/state  (admin) ──────────────────────────────────────
router.get('/admin/state', requireAdmin, async (req, res) => {
  try {
    const cfg = await activeCfg();
    res.json({ round: cfg ? cfg.round : null, status: cfg ? statusOf(cfg) : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── POST /api/dinner/admin/next-edition  (admin) — open the next round ─────────
router.post('/admin/next-edition', requireAdmin, async (req, res) => {
  try {
    const p = parseInput(req.body);
    if (p.error) return res.status(400).json({ error: p.error });
    const row = await db.createNextDinnerEdition({
      opens_at: new Date().toISOString(),
      event_start: p.event_start, event_end: p.event_end, venue: p.venue,
    });
    await db.upsertDinnerCalendarEvent(p.dateYMD);
    const cfg = await activeCfg();
    res.status(201).json({ ok: true, round: row.round, status: statusOf(cfg) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── PATCH /api/dinner/admin/edition  (admin) — edit the active round ───────────
router.patch('/admin/edition', requireAdmin, async (req, res) => {
  try {
    const cfg = await activeCfg();
    if (!cfg) return res.status(404).json({ error: 'ยังไม่มีรอบให้แก้ไข' });
    const p = parseInput(req.body);
    if (p.error) return res.status(400).json({ error: p.error });
    await db.updateDinnerEdition(cfg.round, { event_start: p.event_start, event_end: p.event_end, venue: p.venue });
    await db.upsertDinnerCalendarEvent(p.dateYMD);
    const cfg2 = await activeCfg();
    res.json({ ok: true, round: cfg2.round, status: statusOf(cfg2) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
