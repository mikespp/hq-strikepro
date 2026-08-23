const express = require('express');
const db      = require('../db/database');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();

// Editions ("ครั้งที่ N") live in the DB (the_last_day_editions) so an admin can
// open the next edition at runtime with its own date/time/venue. The active
// edition = the highest edition number. Datetimes are ISO strings with +07:00.
async function activeCfg() {
  const row = await db.getActiveTheLastDayEdition();
  if (!row) return null;
  return {
    edition:    row.edition,
    label:      row.label,
    opensAt:    new Date(row.opens_at),
    eventStart: new Date(row.event_start),
    eventEnd:   new Date(row.event_end),
    venue:      row.venue,
    main:       row.main_seats,
    reserve:    row.reserve_seats,
  };
}

function buildStatus(cfg, dbCount, state = {}) {
  const now    = new Date();
  const isOpen = now >= cfg.opensAt;
  // Registration ends when the event starts, OR an admin closed it / completed the event.
  const ended  = now >= cfg.eventStart || !!state.registration_closed || !!state.event_completed;
  const count  = dbCount;

  let capacity, seatsLeft;
  if (count >= cfg.main + cfg.reserve)      { capacity = 'full';    seatsLeft = 0; }
  else if (count >= cfg.main)               { capacity = 'reserve'; seatsLeft = (cfg.main + cfg.reserve) - count; }
  else                                      { capacity = 'open';    seatsLeft = cfg.main - count; }

  const status = ended ? 'ended' : (isOpen ? capacity : 'closed');

  return {
    edition:      cfg.edition,
    label:        cfg.label,
    count,
    mainSeats:    cfg.main,
    reserveSeats: cfg.reserve,
    opensAt:      cfg.opensAt.toISOString(),
    eventStart:   cfg.eventStart.toISOString(),
    eventEnd:     cfg.eventEnd.toISOString(),
    venue:        cfg.venue,
    now:          now.toISOString(),
    isOpen:       isOpen && !ended,
    ended,
    status,
    capacityStatus: capacity,
    seatsLeft,
    registrationClosed: !!state.registration_closed,
    eventCompleted:     !!state.event_completed,
  };
}

// ── GET /api/the-last-day/status  (public) — active edition status ────────────
router.get('/status', async (req, res) => {
  try {
    const cfg = await activeCfg();
    if (!cfg) return res.status(404).json({ error: 'ยังไม่มีรุ่นที่เปิดรับสมัคร' });
    const count = await db.countTheLastDayRegistrations(cfg.edition);
    const state = await db.getTheLastDayState(cfg.edition);
    res.json(buildStatus(cfg, count, state));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── GET /api/the-last-day/me  (member) — has the user already registered? ─────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const cfg = await activeCfg();
    if (!cfg) return res.json({ registered: false });
    const user = await db.findUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'ไม่พบผู้ใช้' });
    const registered = await db.hasTheLastDayRegistration(user.email, cfg.edition);
    res.json({ registered });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── POST /api/the-last-day/join  (member) — one-click register using profile ──
router.post('/join', requireAuth, async (req, res) => {
  try {
    const cfg = await activeCfg();
    if (!cfg) return res.status(403).json({ error: 'ยังไม่มีรุ่นที่เปิดรับสมัคร' });
    const now = new Date();
    const state = await db.getTheLastDayState(cfg.edition);
    if (state.event_completed)     return res.status(403).json({ error: 'กิจกรรมสิ้นสุดแล้ว' });
    if (state.registration_closed) return res.status(403).json({ error: 'ปิดรับสมัครแล้ว' });
    if (now < cfg.opensAt)     return res.status(403).json({ error: 'ยังไม่เปิดรับสมัคร' });
    if (now >= cfg.eventStart) return res.status(403).json({ error: 'ปิดรับสมัครแล้ว' });

    const user = await db.findUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'ไม่พบผู้ใช้' });

    const missing = ['first_name', 'last_name', 'phone'].filter(k => !user[k] || !String(user[k]).trim());
    if (missing.length)
      return res.status(400).json({ error: 'ข้อมูลโปรไฟล์ไม่ครบ กรุณาอัพเดทข้อมูลก่อนลงทะเบียน', code: 'profile' });

    if (await db.hasTheLastDayRegistration(user.email, cfg.edition))
      return res.status(409).json({ error: 'คุณลงทะเบียนไว้แล้ว', code: 'joined' });

    const data = {
      user_id:    user.id,
      first_name: String(user.first_name).trim().toUpperCase().slice(0, 120),
      last_name:  String(user.last_name).trim().toUpperCase().slice(0, 120),
      nickname:   String(user.nickname || '').trim().slice(0, 120),
      phone:      String(user.phone || '').replace(/\D/g, '').slice(0, 50),
      email:      String(user.email).trim().toLowerCase().slice(0, 255),
      line_id:    String(user.line_id || '').trim().slice(0, 120),
    };

    let result;
    try {
      result = await db.createTheLastDayRegistration(data, cfg.edition, cfg.main, cfg.reserve);
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY')
        return res.status(409).json({ error: 'คุณลงทะเบียนไว้แล้ว', code: 'joined' });
      throw err;
    }
    if (result.full)
      return res.status(409).json({ error: 'ที่นั่งเต็มแล้ว', status: 'full' });

    res.status(201).json({ success: true, label: cfg.label, seat_type: result.seat_type, position: result.position });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── GET /api/the-last-day/registrations  (admin) — active edition's list ──────
router.get('/registrations', requireAdmin, async (req, res) => {
  try {
    const cfg = await activeCfg();
    res.json(await db.listTheLastDayRegistrations(cfg ? cfg.edition : null));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── GET /api/the-last-day/admin/state  (admin) — registration/event flags ─────
router.get('/admin/state', requireAdmin, async (req, res) => {
  try {
    const cfg = await activeCfg();
    if (!cfg) return res.json({ edition: null, registration_closed: false, event_completed: false, status: null });
    const count = await db.countTheLastDayRegistrations(cfg.edition);
    const state = await db.getTheLastDayState(cfg.edition);
    res.json({ edition: cfg.edition, ...state, status: buildStatus(cfg, count, state) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── POST /api/the-last-day/admin/registration  (admin) — open/close signup ────
router.post('/admin/registration', requireAdmin, async (req, res) => {
  try {
    const cfg = await activeCfg();
    if (!cfg) return res.status(404).json({ error: 'ยังไม่มีรุ่น' });
    const state = await db.getTheLastDayState(cfg.edition);
    if (state.event_completed) return res.status(409).json({ error: 'กิจกรรมสิ้นสุดแล้ว ไม่สามารถเปลี่ยนสถานะรับสมัครได้' });
    const closed = !!req.body.closed;
    const next = await db.setTheLastDayState(cfg.edition, { registration_closed: closed });
    res.json({ ok: true, ...next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── POST /api/the-last-day/admin/complete  (admin) — finish event ─────────────
// Marks the event completed and REMOVES everyone who was not checked in
// (unchecked = did not attend = did not pass the activity).
router.post('/admin/complete', requireAdmin, async (req, res) => {
  try {
    const cfg = await activeCfg();
    if (!cfg) return res.status(404).json({ error: 'ยังไม่มีรุ่น' });
    const deleted = await db.deleteUncheckedTheLastDay(cfg.edition);
    const next = await db.setTheLastDayState(cfg.edition, { event_completed: true, registration_closed: true });
    const remaining = await db.countTheLastDayRegistrations(cfg.edition);
    res.json({ ok: true, deleted, remaining, ...next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── POST /api/the-last-day/admin/next-edition  (admin) — open the next edition ─
// Body: { date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM', venue, main?, reserve? }
router.post('/admin/next-edition', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const date  = String(b.date  || '').trim();
    const start = String(b.start || '').trim();
    const end   = String(b.end   || '').trim();
    const venue = String(b.venue || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))  return res.status(400).json({ error: 'กรุณาเลือกวันที่ให้ถูกต้อง' });
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end))
      return res.status(400).json({ error: 'กรุณากรอกเวลาให้ถูกต้อง (HH:MM)' });
    if (!venue) return res.status(400).json({ error: 'กรุณากรอกสถานที่' });

    const eventStartIso = `${date}T${start}:00+07:00`;
    const eventEndIso   = `${date}T${end}:00+07:00`;
    const sd = new Date(eventStartIso), ed = new Date(eventEndIso);
    if (isNaN(sd) || isNaN(ed)) return res.status(400).json({ error: 'วัน/เวลาไม่ถูกต้อง' });
    if (ed <= sd)               return res.status(400).json({ error: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม' });

    const main    = Math.max(1, Math.min(1000, parseInt(b.main, 10)    || 30));
    const reserve = Math.max(0, Math.min(1000, parseInt(b.reserve, 10) || 10));

    const row = await db.createNextTheLastDayEdition({
      opens_at:    new Date().toISOString(), // open immediately
      event_start: eventStartIso,
      event_end:   eventEndIso,
      venue,
      main_seats:    main,
      reserve_seats: reserve,
    });

    const cfg   = await activeCfg();
    const count = await db.countTheLastDayRegistrations(cfg.edition);
    const state = await db.getTheLastDayState(cfg.edition);
    res.status(201).json({ ok: true, edition: row.edition, label: row.label, status: buildStatus(cfg, count, state) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── PATCH /api/the-last-day/registrations/:id/confirm  (admin) — check-in ─────
router.patch('/registrations/:id/confirm', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    await db.setTheLastDayFlag(id, req.body.value ? 1 : 0);
    res.json({ ok: true, id, value: req.body.value ? 1 : 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
