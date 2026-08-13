const express = require('express');
const db      = require('../db/database');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();

// ── Program config — one entry per registration round ────────────────────────
// No VIP hold; 25 main seats + 5 reserve per round. Applicants stored per round.
// Each round opens Wed 12:00 and closes automatically Sun 15:00 (Thai time).
// closesAt in the past (or closed:true) → registration ended: hidden from the selector, apply rejected.
const ROUNDS = {
  2: { label: 'รุ่นที่ 2', opensAt: new Date('2026-07-22T12:00:00+07:00'), closesAt: new Date('2026-07-26T15:00:00+07:00'), main: 25, reserve: 5 },
  3: { label: 'รุ่นที่ 3', opensAt: new Date('2026-07-29T12:00:00+07:00'), closesAt: new Date('2026-08-02T15:00:00+07:00'), main: 25, reserve: 5 },
  // offset: people already registered via the backend (counted toward the round's total)
  4: { label: 'รุ่นที่ 4', opensAt: new Date('2026-08-05T12:00:00+07:00'), closesAt: new Date('2026-08-09T15:00:00+07:00'), main: 25, reserve: 5, offset: 15 },
  5: { label: 'รุ่นที่ 5', opensAt: new Date('2026-08-12T12:00:00+07:00'), closesAt: new Date('2026-08-16T15:00:00+07:00'), main: 25, reserve: 5 },
};

function parseRound(v) {
  const r = parseInt(v, 10);
  return ROUNDS[r] ? r : null;
}

// A round is ended once its closesAt has passed (or if force-closed).
function isEnded(cfg) {
  return !!cfg.closed || (cfg.closesAt && new Date() > cfg.closesAt);
}

// The next joinable round = lowest round number that hasn't ended yet.
function nextJoinRoundNum() {
  const open = Object.keys(ROUNDS).map(Number).filter(r => !isEnded(ROUNDS[r])).sort((a, b) => a - b);
  return open.length ? open[0] : null;
}

function toYMD(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function ageFromYMD(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date();
  let a = t.getFullYear() - y;
  if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) a--;
  return a;
}

function buildStatus(round, dbCount) {
  const cfg    = ROUNDS[round];
  const now    = new Date();
  const isOpen = now >= cfg.opensAt;
  const ended  = isEnded(cfg);
  const count  = dbCount + (cfg.offset || 0); // include backend-registered applicants

  let status, seatsLeft;
  if (count >= cfg.main + cfg.reserve) {
    status = 'full'; seatsLeft = 0;
  } else if (count >= cfg.main) {
    status = 'reserve'; seatsLeft = (cfg.main + cfg.reserve) - count;
  } else {
    status = 'open'; seatsLeft = cfg.main - count;
  }

  // Ended (closesAt passed) → 'ended'; before opensAt → 'closed' (countdown); else capacity status
  const effective = ended ? 'ended' : (isOpen ? status : 'closed');

  return {
    round,
    label:        cfg.label,
    count,
    mainSeats:    cfg.main,
    reserveSeats: cfg.reserve,
    opensAt:      cfg.opensAt.toISOString(),
    closesAt:     cfg.closesAt ? cfg.closesAt.toISOString() : null,
    now:          now.toISOString(),
    isOpen:       isOpen && !ended,
    closed:       ended,
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
      if (isEnded(ROUNDS[r])) continue; // ended rounds are hidden from the selector
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

  // Ended round — no longer accepting applications (closesAt passed)
  if (isEnded(cfg)) {
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
    const result = await db.createLastAccountApplication(data, round, cfg.main, cfg.reserve, cfg.offset || 0);
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

// ── GET /api/last-account/next  (public) — status of the next joinable round ──
router.get('/next', async (req, res) => {
  try {
    const round = nextJoinRoundNum();
    if (!round) return res.json({ round: null });
    const count = await db.countLastAccountApplications(round);
    res.json(buildStatus(round, count));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── POST /api/last-account/join  (member) — one-click join using the profile ─
router.post('/join', requireAuth, async (req, res) => {
  try {
    const round = nextJoinRoundNum();
    if (!round) return res.status(403).json({ error: 'ยังไม่มีรุ่นที่เปิดรับสมัครในขณะนี้' });
    const cfg = ROUNDS[round];
    if (new Date() < cfg.opensAt)
      return res.status(403).json({ error: 'ยังไม่เปิดรับสมัครรุ่นนี้ กรุณารอถึงเวลาเปิดรับสมัคร' });

    const user = await db.findUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'ไม่พบผู้ใช้' });

    const missing = ['first_name', 'last_name', 'phone', 'birth_date'].filter(k => !user[k] || !String(user[k]).trim());
    if (missing.length)
      return res.status(400).json({ error: 'ข้อมูลโปรไฟล์ไม่ครบ กรุณาอัพเดทข้อมูลก่อนลงทะเบียน', code: 'profile' });

    if (await db.hasLastAccountApplication(user.email, round))
      return res.status(409).json({ error: 'คุณลงทะเบียนรุ่นนี้ไว้แล้ว', code: 'joined' });

    const birth = toYMD(user.birth_date);
    const data = {
      first_name:  String(user.first_name).trim().toUpperCase().slice(0, 120),
      last_name:   String(user.last_name).trim().toUpperCase().slice(0, 120),
      nickname:    String(user.nickname || '').trim().slice(0, 120),
      birth_date:  birth,
      age:         ageFromYMD(birth),
      phone:       String(user.phone || '').replace(/\D/g, '').slice(0, 50),
      email:       String(user.email).trim().toLowerCase().slice(0, 255),
      mt5_account: '',
      line_id:     String(user.line_id || '').trim().slice(0, 120),
      discord_id:  '',
    };

    const result = await db.createLastAccountApplication(data, round, cfg.main, cfg.reserve, cfg.offset || 0);
    if (result.full)
      return res.status(409).json({ error: 'รุ่นนี้เต็มแล้ว กรุณารอรอบถัดไป', status: 'full' });

    res.status(201).json({ success: true, round, label: cfg.label, seat_type: result.seat_type, position: result.position });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── PATCH /api/last-account/applications/:id/:flag  (admin) — confirm | intro ─
const FLAG_MAP = { confirm: 'confirmed', intro: 'intro_submitted' };
router.patch('/applications/:id/:flag', requireAdmin, async (req, res) => {
  const field = FLAG_MAP[req.params.flag];
  if (!field) return res.status(400).json({ error: 'invalid flag' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const value = req.body.value ? 1 : 0;
  try {
    await db.setLastAccountFlag(id, field, value);
    res.json({ ok: true, id, flag: req.params.flag, value });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── GET /api/last-account/dashboard  (public) — per-round funnel for the Project dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const funnel = await db.lastAccountDashboard();
    res.json(funnel.map(r => ({ ...r, label: 'รุ่น ' + r.round })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
