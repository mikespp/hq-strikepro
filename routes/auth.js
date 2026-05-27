const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const db      = require('../db/database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'strikepro_dev_secret_change_in_prod';
const TOKEN_TTL  = 7 * 24 * 60 * 60; // 7 days in seconds

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

// ── POST /api/auth/register ───────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Please enter a valid email address.' });

    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    if (await db.findUserByEmail(email))
      return res.status(409).json({ error: 'An account with this email already exists.' });

    const hashed = await bcrypt.hash(password, 12);
    const user   = await db.createUser(email, hashed);
    const token  = await issueToken(user.id);

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
