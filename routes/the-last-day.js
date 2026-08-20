const express = require('express');
const db      = require('../db/database');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();

// ── Event config — one entry per edition ("ครั้งที่ N") ───────────────────────
// Registration opens at opensAt and stays open until seats fill or the event starts.
const EDITIONS = {
  2: {
    label:      'ครั้งที่ 2',
    opensAt:    new Date('2026-08-20T00:00:00+07:00'), // open now
    eventStart: new Date('2026-08-23T10:00:00+07:00'),
    eventEnd:   new Date('2026-08-23T18:00:00+07:00'),
    venue:      'Strike Pro Head Office',
    main:       30,
    reserve:    10,
  },
};
const ACTIVE = 2; // the edition currently accepting registrations

function cfgOf(edition) { return EDITIONS[edition] || null; }

function buildStatus(edition, dbCount) {
  const cfg    = cfgOf(edition);
  const now    = new Date();
  const isOpen = now >= cfg.opensAt;
  const ended  = now >= cfg.eventStart; // registration closes when the event begins
  const count  = dbCount;

  let capacity, seatsLeft;
  if (count >= cfg.main + cfg.reserve)      { capacity = 'full';    seatsLeft = 0; }
  else if (count >= cfg.main)               { capacity = 'reserve'; seatsLeft = (cfg.main + cfg.reserve) - count; }
  else                                      { capacity = 'open';    seatsLeft = cfg.main - count; }

  const status = ended ? 'ended' : (isOpen ? capacity : 'closed');

  return {
    edition,
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
  };
}

// ── GET /api/the-last-day/status  (public) — active edition status ────────────
router.get('/status', async (req, res) => {
  try {
    const count = await db.countTheLastDayRegistrations(ACTIVE);
    res.json(buildStatus(ACTIVE, count));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── GET /api/the-last-day/me  (member) — has the user already registered? ─────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.findUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'ไม่พบผู้ใช้' });
    const registered = await db.hasTheLastDayRegistration(user.email, ACTIVE);
    res.json({ registered });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── POST /api/the-last-day/join  (member) — one-click register using profile ──
router.post('/join', requireAuth, async (req, res) => {
  try {
    const cfg = cfgOf(ACTIVE);
    const now = new Date();
    if (now < cfg.opensAt)     return res.status(403).json({ error: 'ยังไม่เปิดรับสมัคร' });
    if (now >= cfg.eventStart) return res.status(403).json({ error: 'ปิดรับสมัครแล้ว' });

    const user = await db.findUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'ไม่พบผู้ใช้' });

    const missing = ['first_name', 'last_name', 'phone'].filter(k => !user[k] || !String(user[k]).trim());
    if (missing.length)
      return res.status(400).json({ error: 'ข้อมูลโปรไฟล์ไม่ครบ กรุณาอัพเดทข้อมูลก่อนลงทะเบียน', code: 'profile' });

    if (await db.hasTheLastDayRegistration(user.email, ACTIVE))
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
      result = await db.createTheLastDayRegistration(data, ACTIVE, cfg.main, cfg.reserve);
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

// ── GET /api/the-last-day/registrations  (admin) ──────────────────────────────
router.get('/registrations', requireAdmin, async (req, res) => {
  try {
    res.json(await db.listTheLastDayRegistrations());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── PATCH /api/the-last-day/registrations/:id/confirm  (admin) ────────────────
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
