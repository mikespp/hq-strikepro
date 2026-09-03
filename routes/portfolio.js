const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { computeFund } = require('../lib/portfolio-calc');

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

// ── POST /api/portfolio/sync  (sync key) — VPS pushes account list + daily rows ─
// Body: { accounts:[{login,label,server,currency}], snapshots:[{login,d,balance,equity,deposit,withdrawal}] }
router.post('/sync', requireSyncKey, async (req, res) => {
  const accounts  = Array.isArray(req.body.accounts)  ? req.body.accounts  : [];
  const snapshots = Array.isArray(req.body.snapshots) ? req.body.snapshots : [];
  try {
    for (const a of accounts) {
      const login = parseInt(a.login, 10);
      if (login) await db.upsertPortfolioAccount(login, a);
    }
    let n = 0;
    for (const s of snapshots) {
      const login = parseInt(s.login, 10);
      if (!login || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.d || ''))) continue;
      await db.upsertPortfolioAccount(login, {});   // ensure the account row exists
      await db.upsertPortfolioDaily(login, s);
      n++;
    }
    res.json({ ok: true, accounts: accounts.length, snapshots: n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sync failed.' });
  }
});

// ── GET /api/portfolio  (public) — fund performance (Myfxbook-style TWR) ───────
router.get('/', async (req, res) => {
  try {
    const [rows, accts] = await Promise.all([db.getPortfolioDaily(), db.listPortfolioAccounts()]);
    const out = computeFund(rows);
    const labels = new Map(accts.map(a => [Number(a.login), a.label]));
    out.accounts.forEach(a => { a.label = labels.get(Number(a.login)) || ('#' + a.login); });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
