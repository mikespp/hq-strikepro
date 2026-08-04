const express = require('express');
const db      = require('../db/database');
const { requireAdmin } = require('./auth');

const router = express.Router();

// ── Program config — one entry per registration round ────────────────────────
// No VIP hold; 25 main seats + 5 reserve per round. Applicants stored per round.
// closed: true → registration has ended for that round (hidden from the selector, apply rejected)
const ROUNDS = {
  2: { label: 'รุ่นที่ 2', opensAt: new Date('2026-07-22T12:00:00+07:00'), main: 25, reserve: 5, closed: true },
  3: { label: 'รุ่นที่ 3', opensAt: new Date('2026-07-29T12:00:00+07:00'), main: 25, reserve: 5, closed: true },
  4: { label: 'รุ่นที่ 4', opensAt: new Date('2026-08-05T12:00:00+07:00'), main: 25, reserve: 5 },
};

function parseRound(v) {
  const r = parseInt(v, 10);
  return ROUNDS[r] ? r : null;
}

function buildStatus(round, count) {
  const cfg    = ROUNDS[round];
  const now    = new Date();
  const isOpen = now >= cfg.opensAt;

  let status, seatsLeft;
  if (count >= cfg.main + cfg.reserve) {
    status = 'full'; seatsLeft = 0;
  } else if (count >= cfg.main) {
    status = 'reserve'; seatsLeft = (cfg.main + cfg.reserve) - count;
  } else {
    status = 'open'; seatsLeft = cfg.main - count;
  }

  // Manually-closed rounds report 'ended'; otherwise 'closed' (before opensAt) wins over capacity
  const effective = cfg.closed ? 'ended' : (isOpen ? status : 'closed');

  return {
    round,
    label:        cfg.label,
    count,
    mainSeats:    cfg.main,
    reserveSeats: cfg.reserve,
    opensAt:      cfg.opensAt.toISOString(),
    now:          now.toISOString(),
    isOpen:       isOpen && !cfg.closed,
    closed:       !!cfg.closed,
    status:       effective,
    capacityStatus: status,
    seatsLeft,
  };
}

// ── GET /api/last-account/rounds  (public) — all rounds' status ──────────────
router.get('/rounds', async (req, res) => {
  try {
    const out = [];
    for (const r of Object.keys(ROUNDS)) {
      if (ROUNDS[r].closed) continue; // ended rounds are hidden from the selector
      const round = parseInt(r, 10);
      const count = await db.countLastAccountApplications(round);
      out.push(buildStatus(round, count));
    }
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── GET /api/last-account/status?round=N  (public) ───────────────────────────
router.get('/status', async (req, res) => {
  const round = parseRound(req.query.round);
  if (!round) return res.status(400).json({ error: 'รุ่นไม่ถูกต้อง' });
  try {
    const count = await db.countLastAccountApplications(round);
    res.json(buildStatus(round, count));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── POST /api/last-account/apply  (public) ───────────────────────────────────
router.post('/apply', async (req, res) => {
  const {
    round: roundRaw,
    first_name, last_name, nickname, birth_date, age,
    phone, email, mt5_account, line_id, discord_id,
  } = req.body;

  const round = parseRound(roundRaw);
  if (!round) return res.status(400).json({ error: 'กรุณาเลือกรุ่นที่ต้องการสมัคร' });
  const cfg = ROUNDS[round];

  // Ended round — no longer accepting applications
  if (cfg.closed) {
    return res.status(403).json({ error: 'ปิดรับสมัครรุ่นนี้แล้ว กรุณาสมัครในรอบถัดไป' });
  }

  // Registration window
  if (new Date() < cfg.opensAt) {
    return res.status(403).json({ error: 'ยังไม่เปิดรับสมัครรุ่นนี้ กรุณารอถึงเวลาเปิดรับสมัคร' });
  }

  // Validation — all fields required
  const required = { first_name, last_name, nickname, birth_date, phone, email, line_id, discord_id };
  for (const [, val] of Object.entries(required)) {
    if (!val || !String(val).trim()) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    return res.status(400).json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birth_date).trim())) {
    return res.status(400).json({ error: 'รูปแบบวันเกิดไม่ถูกต้อง' });
  }
  const ageNum = parseInt(age, 10);
  if (!Number.isFinite(ageNum) || ageNum < 1 || ageNum > 120) {
    return res.status(400).json({ error: 'อายุไม่ถูกต้อง' });
  }
  // Phone is stored digits-only; reject if nothing is left after stripping
  const phoneDigits = String(phone).replace(/\D/g, '');
  if (!phoneDigits) {
    return res.status(400).json({ error: 'เบอร์โทรศัพท์ต้องเป็นตัวเลขเท่านั้น' });
  }

  const data = {
    first_name:  String(first_name).trim().toUpperCase().slice(0, 120),
    last_name:   String(last_name).trim().toUpperCase().slice(0, 120),
    nickname:    String(nickname).trim().slice(0, 120),
    birth_date:  String(birth_date).trim(),
    age:         ageNum,
    phone:       phoneDigits.slice(0, 50),
    email:       String(email).trim().toLowerCase().slice(0, 255),
    mt5_account: String(mt5_account || '').trim().slice(0, 60), // no longer collected; kept for existing records
    line_id:     String(line_id).trim().slice(0, 120),
    discord_id:  String(discord_id).trim().slice(0, 120),
  };

  try {
    const result = await db.createLastAccountApplication(data, round, cfg.main, cfg.reserve);
    if (result.full) {
      return res.status(409).json({ error: 'เต็มแล้ว ไม่สามารถสมัครได้ กรุณารอรอบถัดไป', status: 'full' });
    }
    res.status(201).json({
      success:   true,
      round,
      seat_type: result.seat_type, // 'main' | 'reserve'
      position:  result.position,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── GET /api/last-account/applications  (admin) ──────────────────────────────
router.get('/applications', requireAdmin, async (req, res) => {
  try {
    const rows = await db.listLastAccountApplications();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
