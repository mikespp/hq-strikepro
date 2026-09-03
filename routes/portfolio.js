const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { computeMasters } = require('../lib/portfolio-calc');

const router = express.Router();

// Shared-secret guard for the VPS fetcher (reuses ELIGIBILITY_SYNC_KEY).
function requireSyncKey(req, res, next) {
  const key = process.env.ELIGIBILITY_SYNC_KEY;
  const got = req.get('X-Sync-Key') || '';
  const a = Buffer.from(got), b = Buffer.from(key || '');
  if (!key || a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── POST /api/portfolio/sync  (sync key) — VPS pushes the master figures ───────
// Body: { masters: [{ account_id, name, currency, aum, balance, equity, followers,
//   score, risk, max_dd, profit_factor, p_week, p_month, p_3m, p_6m, p_12m, p_18m,
//   p_all, sort_order, minichart:[{timestamp,etwr,btwr,balance,equity}] }] }
// These are the StrikePro widget API's own deposit/withdrawal-neutral returns.
router.post('/sync', requireSyncKey, async (req, res) => {
  const masters = Array.isArray(req.body.masters) ? req.body.masters : [];
  try {
    let n = 0;
    for (const m of masters) {
      if (!m || !m.account_id) continue;
      await db.upsertMaster(m);
      n++;
    }
    res.json({ ok: true, masters: n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sync failed.' });
  }
});

// ── GET /api/portfolio  (public) — พอร์ต Master performance ────────────────────
router.get('/', async (req, res) => {
  try {
    const rows = await db.listMasters();
    res.json(computeMasters(rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
