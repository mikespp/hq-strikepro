const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const db      = require('../db/database');
const { sendOtpEmail } = require('../lib/mailer');

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

// ── Registration (gated by StrikePro customer allowlist + email OTP) ──────────

// STEP 1 — POST /api/auth/register/check  { email }  → eligibility check + send OTP
router.post('/register/check', async (req, res) => {
  try {
    const email = normEmail(req.body.email);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'กรุณากรอกอีเมลให้ถูกต้อง' });
    if (!rateLimit('chk:' + clientIp(req), 20, 60 * 60 * 1000))
      return res.status(429).json({ error: 'ขอรหัสบ่อยเกินไป กรุณาลองใหม่ภายหลัง' });

    if (await db.findUserByEmail(email))
      return res.status(409).json({ error: 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ', code: 'exists' });

    if (!(await db.isEmailEligible(emailHash(email))))
      return res.status(403).json({ error: 'ไม่พบอีเมลนี้ในระบบลูกค้า StrikePro จึงไม่สามารถสมัครได้', code: 'not_eligible' });

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

// STEP 2 — POST /api/auth/register/verify  { email, code }  → registration ticket
router.post('/register/verify', async (req, res) => {
  try {
    const email = normEmail(req.body.email);
    const code  = String(req.body.code || '').trim();
    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code))
      return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
    if (!rateLimit('vrf:' + clientIp(req), 40, 60 * 60 * 1000))
      return res.status(429).json({ error: 'ลองบ่อยเกินไป กรุณารอสักครู่' });

    const otp = await db.getOtp(email);
    if (!otp || Date.now() > Number(otp.expires_at))
      return res.status(400).json({ error: 'รหัสหมดอายุ กรุณาขอรหัสใหม่', code: 'expired' });
    if (otp.attempts >= 5) {
      await db.deleteOtp(email);
      return res.status(429).json({ error: 'กรอกรหัสผิดเกินกำหนด กรุณาขอรหัสใหม่', code: 'expired' });
    }
    const ok = await bcrypt.compare(code, otp.code_hash);
    if (!ok) {
      await db.incOtpAttempts(email);
      return res.status(400).json({ error: 'รหัสยืนยันไม่ถูกต้อง' });
    }
    await db.deleteOtp(email);
    const ticket = jwt.sign({ purpose: 'register', email }, JWT_SECRET, { expiresIn: 15 * 60 });
    res.json({ ok: true, ticket });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// STEP 3 — POST /api/auth/register  { ticket, fullName, phone, password }  → create account
router.post('/register', async (req, res) => {
  try {
    const { ticket, fullName, phone, password } = req.body;
    let email;
    try {
      const p = jwt.verify(ticket || '', JWT_SECRET);
      if (p.purpose !== 'register' || !p.email) throw new Error('bad ticket');
      email = normEmail(p.email);
    } catch {
      return res.status(401).json({ error: 'เซสชันสมัครหมดอายุ กรุณาเริ่มสมัครใหม่', code: 'ticket' });
    }

    if (!fullName || !String(fullName).trim())
      return res.status(400).json({ error: 'กรุณากรอกชื่อ-นามสกุล' });
    if (!password || String(password).length < 8)
      return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' });

    // defence in depth — re-check the guards
    if (await db.findUserByEmail(email))
      return res.status(409).json({ error: 'อีเมลนี้มีบัญชีอยู่แล้ว', code: 'exists' });
    if (!(await db.isEmailEligible(emailHash(email))))
      return res.status(403).json({ error: 'ไม่พบอีเมลนี้ในระบบลูกค้า', code: 'not_eligible' });

    const hashed = await bcrypt.hash(password, 12);
    const user   = await db.createUserFull(email, hashed, String(fullName).trim(), String(phone || '').trim());
    const token  = await issueToken(user.id);
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
    res.json({ user: { id: user.id, email: user.email, role: user.role || 'user' } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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

module.exports = { router, requireAuth, requireAdmin };
