const express = require('express');
const db      = require('../db/database');
const { requireAdmin } = require('./auth');

const router = express.Router();

// ── Program config ───────────────────────────────────────────────────────────
const MAIN_SEATS    = 20;
const RESERVE_SEATS = 5;
// Registration opens 6 July 2026, 12:00 Thai time (UTC+7)
const OPENS_AT = new Date('2026-07-06T12:00:00+07:00');

function buildStatus(count) {
  const now    = new Date();
  const isOpen = now >= OPENS_AT;

  let status, seatsLeft;
  if (count >= MAIN_SEATS + RESERVE_SEATS) {
    status = 'full'; seatsLeft = 0;
  } else if (count >= MAIN_SEATS) {
    status = 'reserve'; seatsLeft = (MAIN_SEATS + RESERVE_SEATS) - count; // remaining reserve seats
  } else {
    status = 'open'; seatsLeft = MAIN_SEATS - count;
  }

  return {
    count,
    mainSeats:    MAIN_SEATS,
    reserveSeats: RESERVE_SEATS,
    opensAt:      OPENS_AT.toISOString(),
    now:          now.toISOString(),
    isOpen,
    // 'closed' (not open yet) takes precedence over capacity status
    status: isOpen ? status : 'closed',
    capacityStatus: status,
    seatsLeft,
  };
}

// ── GET /api/last-account/status  (public) ───────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const count = await db.countLastAccountApplications();
    res.json(buildStatus(count));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── POST /api/last-account/apply  (public) ───────────────────────────────────
router.post('/apply', async (req, res) => {
  const {
    first_name, last_name, nickname,
    phone, email, mt5_account, line_id, discord_id,
  } = req.body;

  // Registration window
  if (new Date() < OPENS_AT) {
    return res.status(403).json({ error: 'ยังไม่เปิดรับสมัคร กรุณารอวันที่ 6 ก.ค. 2026 เวลา 12:00 น.' });
  }

  // Validation
  const required = { first_name, last_name, nickname, phone, email, mt5_account, line_id, discord_id };
  for (const [key, val] of Object.entries(required)) {
    if (!val || !String(val).trim()) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    return res.status(400).json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' });
  }

  const data = {
    first_name:  String(first_name).trim().slice(0, 120),
    last_name:   String(last_name).trim().slice(0, 120),
    nickname:    String(nickname  || '').trim().slice(0, 120),
    phone:       String(phone).trim().slice(0, 50),
    email:       String(email).trim().slice(0, 255),
    mt5_account: String(mt5_account).trim().slice(0, 60),
    line_id:     String(line_id    || '').trim().slice(0, 120),
    discord_id:  String(discord_id || '').trim().slice(0, 120),
  };

  try {
    const result = await db.createLastAccountApplication(data, MAIN_SEATS, RESERVE_SEATS);
    if (result.full) {
      return res.status(409).json({ error: 'เต็มแล้ว ไม่สามารถสมัครได้ กรุณารอรอบถัดไป', status: 'full' });
    }
    res.status(201).json({
      success:   true,
      seat_type: result.seat_type,        // 'main' | 'reserve'
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
