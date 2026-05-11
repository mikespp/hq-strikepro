const express         = require('express');
const db              = require('../db/database');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

// ── Sanitise & cast incoming body ─────────────────────────────────────────────

function sanitize(body) {
  const num = (v, def = null) => (v !== '' && v != null) ? (parseFloat(v) || def) : def;
  return {
    name:                    (body.name || '').trim(),
    phone:                   (body.phone || '').trim(),
    email:                   (body.email || '').trim(),
    line_id:                 (body.line_id || '').trim(),
    channel:                 body.channel || '',
    activities:              Array.isArray(body.activities)       ? body.activities       : [],
    prev_investments:        Array.isArray(body.prev_investments) ? body.prev_investments : [],
    investment_reason:       (body.investment_reason || '').trim(),
    expected_profit_pct:     num(body.expected_profit_pct),
    expected_monthly_profit: num(body.expected_monthly_profit),
    estimated_capital:       num(body.estimated_capital),
    ppvp_usd:                num(body.ppvp_usd, 0),
    hq_ultimate_usd:         num(body.hq_ultimate_usd, 0),
    golden_boy_usd:          num(body.golden_boy_usd, 0),
    self_trade_usd:          num(body.self_trade_usd, 0),
    not_invested_reason:     (body.not_invested_reason || '').trim(),
    follow_up:               Array.isArray(body.follow_up) ? body.follow_up : [],
    notes:                   (body.notes || '').trim(),
  };
}

function validateName(body, res) {
  if (!body.name || !body.name.trim()) {
    res.status(400).json({ error: 'ชื่อลูกค้าเป็นข้อมูลที่จำเป็น' });
    return false;
  }
  return true;
}

// ── GET /api/clients ──────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    res.json({ clients: await db.getAllClients(req.userId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── POST /api/clients ─────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const data = sanitize(req.body);
    if (!validateName(data, res)) return;
    const client = await db.createClient(req.userId, data);
    db.refreshUserStats(req.userId).catch(console.error); // async, non-blocking
    res.status(201).json({ client });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── GET /api/clients/:id ──────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const client = await db.getClientById(parseInt(req.params.id), req.userId);
    if (!client) return res.status(404).json({ error: 'ไม่พบข้อมูลลูกค้า' });
    res.json({ client });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── PUT /api/clients/:id ──────────────────────────────────────────────────────

router.put('/:id', async (req, res) => {
  try {
    const data = sanitize(req.body);
    if (!validateName(data, res)) return;
    const client = await db.updateClient(parseInt(req.params.id), req.userId, data);
    if (!client) return res.status(404).json({ error: 'ไม่พบข้อมูลลูกค้า' });
    db.refreshUserStats(req.userId).catch(console.error); // async, non-blocking
    res.json({ client });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── DELETE /api/clients/:id ───────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    const ok = await db.deleteClient(parseInt(req.params.id), req.userId);
    if (!ok) return res.status(404).json({ error: 'ไม่พบข้อมูลลูกค้า' });
    db.refreshUserStats(req.userId).catch(console.error); // async, non-blocking
    res.json({ message: 'ลบข้อมูลลูกค้าแล้ว' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
