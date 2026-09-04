const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const db      = require('../db/database');
const { sendOtpEmail } = require('../lib/mailer');
const { isSuperAdmin } = require('../lib/super-admin');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'strikepro_dev_secret_change_in_prod';
const TOKEN_TTL  = 7 * 24 * 60 * 60; // 7 days in seconds

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail  = e => String(e || '').trim().toLowerCase();
const emailHash  = e => crypto.createHash('sha256').update(normEmail(e)).digest('hex');
const genOtp     = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const clientIp   = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';

// simple in-memory rate limiter (per instance) — fine for low-volume registration
const _rl = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now(); const e = _rl.get(key);
  if (!e || now > e.resetAt) { _rl.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (e.count >= max) return false;
  e.count++; return true;
}

// Is this email a StrikePro customer? Prefer a live check against the VPS endpoint
// (ELIGIBILITY_CHECK_URL); fall back to the synced local allowlist if not configured.
// Throws on service error so the caller can fail closed (503) rather than mis-deny.
async function checkEligible(email) {
  const url = process.env.ELIGIBILITY_CHECK_URL;
  if (url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Check-Key': process.env.ELIGIBILITY_SYNC_KEY || '' },
        body: JSON.stringify({ email }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error('eligibility service HTTP ' + r.status);
      const d = await r.json();
      return !!d.eligible;
    } finally { clearTimeout(timer); }
  }
  return db.isEmailEligible(emailHash(email)); // fallback: local allowlist
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function issueToken(userId) {
  const jti       = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL * 1000).toISOString();
  await db.createSession(userId, jti, expiresAt);
  return jwt.sign({ sub: userId, jti }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const session = await db.findSession(payload.jti);
    if (!session) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    const user = await db.findUserById(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found.' });
    req.userId = payload.sub;
    req.jti    = payload.jti;
    req.user   = { id: user.id, email: user.email, role: user.role || 'user' };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token.' });
  }
}

async function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  });
}

// Owner-only (protected super-admin). Used for settings only the owner may change.
async function requireSuperAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!isSuperAdmin(req.user.email)) {
      return res.status(403).json({ error: 'เฉพาะเจ้าของระบบ (Super Admin) เท่านั้น' });
    }
    next();
  });
}

// ── Registration (gated by StrikePro customer allowlist + email OTP) ──────────
// Flow: check(email) → [fill profile form] → send-otp(email) → register(email+code+profile)

// helper: reject only if the email already has an account. Returns null if ok.
// NOTE: StrikePro-customer eligibility is NO LONGER a gate — anyone who can verify
// their email via OTP may register. Eligibility is recorded as an advisory
// `verified` flag (see registerVerifiedFlag) and staff screen at contact-back.
async function guardEmail(email) {
  if (await db.findUserByEmail(email))
    return { status: 409, body: { error: 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ', code: 'exists' } };
  return null;
}

// Best-effort: is this email a known StrikePro customer? Never throws — a failure
// or a miss just means verified=0 (registration still proceeds).
async function registerVerifiedFlag(email) {
  try { return !!(await checkEligible(email)); }
  catch (e) { console.error('eligibility flag check failed:', e.message); return false; }
}

// STEP 1 — POST /api/auth/register/check  { email }  → eligibility only (no OTP yet)
router.post('/register/check', async (req, res) => {
  try {
    const email = normEmail(req.body.email);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'กรุณากรอกอีเมลให้ถูกต้อง' });
    if (!rateLimit('chk:' + clientIp(req), 40, 60 * 60 * 1000))
      return res.status(429).json({ error: 'ลองบ่อยเกินไป กรุณารอสักครู่' });
    const bad = await guardEmail(email);
    if (bad) return res.status(bad.status).json(bad.body);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// STEP 2 — POST /api/auth/register/send-otp  { email }  → send OTP (after the profile form)
router.post('/register/send-otp', async (req, res) => {
  try {
    const email = normEmail(req.body.email);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'กรุณากรอกอีเมลให้ถูกต้อง' });
    if (!rateLimit('otpip:' + clientIp(req), 20, 60 * 60 * 1000))
      return res.status(429).json({ error: 'ขอรหัสบ่อยเกินไป กรุณาลองใหม่ภายหลัง' });
    const bad = await guardEmail(email);
    if (bad) return res.status(bad.status).json(bad.body);
    if (!rateLimit('otp:' + email, 5, 60 * 60 * 1000))
      return res.status(429).json({ error: 'ขอรหัสบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' });

    const code = genOtp();
    const codeHash = await bcrypt.hash(code, 8);
    await db.upsertOtp(email, codeHash, Date.now() + 10 * 60 * 1000);
    try {
      await sendOtpEmail(email, code);
    } catch (e) {
      console.error('OTP send failed:', e.message);
      return res.status(502).json({ error: 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
    }
    res.json({ ok: true, message: 'ส่งรหัสยืนยันไปที่อีเมลแล้ว' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// STEP 3 — POST /api/auth/register  { email, code, fullName, phone, password }  → verify OTP + create
router.post('/register', async (req, res) => {
  try {
    const email = normEmail(req.body.email);
    const code  = String(req.body.code || '').trim();
    const s = v => String(v || '').trim();
    const b = req.body;
    const firstName=s(b.firstName), lastName=s(b.lastName), nickname=s(b.nickname),
          phone=s(b.phone), birthDate=s(b.birthDate), lineId=s(b.lineId),
          addrLine=s(b.addrLine), subdistrict=s(b.subdistrict), district=s(b.district),
          province=s(b.province), postalCode=s(b.postalCode), password=String(b.password || '');
    const avatarData = b.avatarData ? String(b.avatarData) : null;

    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code))
      return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
    const requiredFields = { firstName, lastName, nickname, phone, birthDate, lineId, addrLine, subdistrict, district, province, postalCode };
    for (const v of Object.values(requiredFields))
      if (!v) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate))
      return res.status(400).json({ error: 'วันเดือนปีเกิดไม่ถูกต้อง' });
    if (!/^\d{5}$/.test(postalCode))
      return res.status(400).json({ error: 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก' });
    if (password.length < 8)
      return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' });
    if (avatarData && (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(avatarData) || avatarData.length > 3_000_000))
      return res.status(400).json({ error: 'รูปโปรไฟล์ไม่ถูกต้องหรือใหญ่เกินไป' });
    if (!rateLimit('reg:' + clientIp(req), 40, 60 * 60 * 1000))
      return res.status(429).json({ error: 'ลองบ่อยเกินไป กรุณารอสักครู่' });

    // verify OTP
    const otp = await db.getOtp(email);
    if (!otp || Date.now() > Number(otp.expires_at))
      return res.status(400).json({ error: 'รหัสหมดอายุ กรุณาขอรหัสใหม่', code: 'expired' });
    if (otp.attempts >= 5) {
      await db.deleteOtp(email);
      return res.status(429).json({ error: 'กรอกรหัสผิดเกินกำหนด กรุณาขอรหัสใหม่', code: 'expired' });
    }
    const okCode = await bcrypt.compare(code, otp.code_hash);
    if (!okCode) {
      await db.incOtpAttempts(email);
      return res.status(400).json({ error: 'รหัสยืนยันไม่ถูกต้อง' });
    }

    // defence in depth — re-check eligibility / not-exists
    const bad = await guardEmail(email);
    if (bad) return res.status(bad.status).json(bad.body);

    await db.deleteOtp(email);
    const verified = await registerVerifiedFlag(email); // advisory only, never blocks
    const hashed = await bcrypt.hash(password, 12);
    const user = await db.createMember({
      email, hashedPassword: hashed, firstName, lastName, nickname, phone, birthDate,
      lineId, addrLine, subdistrict, district, province, postalCode, avatarData, verified,
    });
    const token = await issueToken(user.id);
    res.status(201).json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    const user = await db.findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

    const token = await issueToken(user.id);
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.findUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: {
      id: user.id, email: user.email, role: user.role || 'user',
      nickname: user.nickname || '', avatar: user.avatar_data || null,
      is_super: isSuperAdmin(user.email),
    } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── GET /api/auth/profile ─── full editable profile (for the update-profile form)
const toYMD = v => {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const u = await db.findUserById(req.userId);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    res.json({ profile: {
      email:       u.email,
      firstName:   u.first_name  || '',
      lastName:    u.last_name   || '',
      nickname:    u.nickname    || '',
      phone:       u.phone       || '',
      birthDate:   toYMD(u.birth_date),
      lineId:      u.line_id     || '',
      addrLine:    u.addr_line   || '',
      subdistrict: u.subdistrict || '',
      district:    u.district    || '',
      province:    u.province    || '',
      postalCode:  u.postal_code || '',
      avatar:      u.avatar_data || null,
    } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// ── PATCH /api/auth/profile ─── update the member's own profile ────────────────
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const s = v => String(v || '').trim();
    const b = req.body;
    const firstName=s(b.firstName), lastName=s(b.lastName), nickname=s(b.nickname),
          phone=s(b.phone), birthDate=s(b.birthDate), lineId=s(b.lineId),
          addrLine=s(b.addrLine), subdistrict=s(b.subdistrict), district=s(b.district),
          province=s(b.province), postalCode=s(b.postalCode);
    const avatarData = b.avatarData ? String(b.avatarData) : null;

    const requiredFields = { firstName, lastName, nickname, phone, birthDate, lineId, addrLine, subdistrict, district, province, postalCode };
    for (const v of Object.values(requiredFields))
      if (!v) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate))
      return res.status(400).json({ error: 'วันเดือนปีเกิดไม่ถูกต้อง' });
    if (!/^\d{5}$/.test(postalCode))
      return res.status(400).json({ error: 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก' });
    if (avatarData && (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(avatarData) || avatarData.length > 3_000_000))
      return res.status(400).json({ error: 'รูปโปรไฟล์ไม่ถูกต้องหรือใหญ่เกินไป' });

    await db.updateUserProfile(req.userId, {
      firstName, lastName, nickname, phone, birthDate, lineId,
      addrLine, subdistrict, district, province, postalCode, avatarData,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

router.post('/logout', requireAuth, async (req, res) => {
  try {
    await db.deleteSession(req.jti);
    res.json({ message: 'Signed out successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = { router, requireAuth, requireAdmin, requireSuperAdmin, checkEligible };
