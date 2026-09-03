const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const secret  = require('../lib/secret');
const { requireAdmin } = require('./auth');
const { computePortfolio } = require('../lib/portfolio-calc');

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

// ── GET /api/portfolio/accounts  (sync key) — creds for the VPS loop-login fetcher ─
// Returns decrypted investor passwords ONLY over the sync-key-authenticated channel.
router.get('/accounts', requireSyncKey, async (req, res) => {
  try {
    const rows = await db.listMasterAccountsForFetch();
    res.json(rows.map(r => ({
      login: Number(r.login), server: r.server || '', currency: r.currency || 'USD',
      investor_password: secret.decrypt(r.inv_pw),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list accounts.' });
  }
});

// ── POST /api/portfolio/sync  (sync key) — VPS pushes hourly snapshots ──────────
// Body: { snapshots:[{login,d,balance,equity,deposit,withdrawal}], accounts?:[{login,label,server,currency}] }
router.post('/sync', requireSyncKey, async (req, res) => {
  const accounts  = Array.isArray(req.body.accounts)  ? req.body.accounts  : [];
  const snapshots = Array.isArray(req.body.snapshots) ? req.body.snapshots : [];
  try {
    for (const a of accounts) {
      const login = parseInt(a.login, 10);
      if (login) await db.upsertPortfolioAccount(login, a);   // label/server/currency only
    }
    let n = 0;
    for (const s of snapshots) {
      const login = parseInt(s.login, 10);
      if (!login || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.d || ''))) continue;
      await db.upsertPortfolioDaily(login, s);
      n++;
    }
    res.json({ ok: true, accounts: accounts.length, snapshots: n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sync failed.' });
  }
});

// ── Admin: manage master accounts (MT5 ID + investor password) ──────────────────
router.get('/admin/accounts', requireAdmin, async (req, res) => {
  try { res.json(await db.listMasterAccountsAdmin()); }
  catch (err) { console.error(err); res.status(500).json({ error: 'เกิดข้อผิดพลาด' }); }
});

router.post('/admin/accounts', requireAdmin, async (req, res) => {
  const login = parseInt(req.body.login, 10);
  if (!login) return res.status(400).json({ error: 'กรุณากรอก MT5 ID ให้ถูกต้อง' });
  const label = String(req.body.label || '').trim();
  if (!label) return res.status(400).json({ error: 'กรุณากรอกชื่อพอร์ต' });
  const pw = req.body.investor_password;
  try {
    await db.saveMasterAccount(login, {
      label, server: req.body.server, currency: req.body.currency,
      sort_order: req.body.sort_order, active: req.body.active === 0 ? 0 : 1,
      invPwEnc: (pw && String(pw).length) ? secret.encrypt(String(pw)) : undefined,  // undefined = keep existing
    });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'บันทึกไม่สำเร็จ' }); }
});

router.patch('/admin/accounts/:login', requireAdmin, async (req, res) => {
  const login = parseInt(req.params.login, 10);
  if (!login) return res.status(400).json({ error: 'invalid' });
  try {
    if (typeof req.body.active !== 'undefined' && Object.keys(req.body).length === 1) {
      await db.setMasterActive(login, req.body.active ? 1 : 0);
    } else {
      const pw = req.body.investor_password;
      await db.saveMasterAccount(login, {
        label: req.body.label, server: req.body.server, currency: req.body.currency,
        sort_order: req.body.sort_order, active: req.body.active === 0 ? 0 : 1,
        invPwEnc: (pw && String(pw).length) ? secret.encrypt(String(pw)) : undefined,
      });
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'บันทึกไม่สำเร็จ' }); }
});

router.delete('/admin/accounts/:login', requireAdmin, async (req, res) => {
  const login = parseInt(req.params.login, 10);
  if (!login) return res.status(400).json({ error: 'invalid' });
  try { await db.deleteMasterAccount(login); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'ลบไม่สำเร็จ' }); }
});

// ── GET /api/portfolio  (public) — พอร์ต Master performance ────────────────────
router.get('/', async (req, res) => {
  try {
    const [rows, accts] = await Promise.all([db.getPortfolioDaily(), db.listPortfolioAccounts()]);
    res.json(computePortfolio(rows, accts));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
