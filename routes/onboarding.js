const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAdmin } = require('./auth');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Shared-secret guard for the future data feed (reuses ELIGIBILITY_SYNC_KEY).
function requireSyncKey(req, res, next) {
  const key = process.env.ELIGIBILITY_SYNC_KEY;
  const got = req.get('X-Sync-Key') || '';
  const a = Buffer.from(got), b = Buffer.from(key || '');
  if (!key || a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Steps (configurable checklist) ──────────────────────────────────────────────
router.get('/steps', requireAdmin, async (req, res) => {
  try { res.json(await db.listOnboardingSteps()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาด' }); }
});
router.post('/steps', requireAdmin, async (req, res) => {
  const label = String(req.body.label || '').trim();
  if (!label) return res.status(400).json({ error: 'กรุณากรอกชื่อขั้นตอน' });
  try { const id = await db.addOnboardingStep({ label, step_key: req.body.step_key, sort_order: req.body.sort_order });
    res.json({ ok: true, id }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'บันทึกไม่สำเร็จ' }); }
});
router.patch('/steps/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid' });
  try { const ok = await db.updateOnboardingStep(id, req.body);
    res.json({ ok }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'บันทึกไม่สำเร็จ' }); }
});
router.delete('/steps/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid' });
  try { await db.deleteOnboardingStep(id); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'ลบไม่สำเร็จ' }); }
});

// ── Customers ───────────────────────────────────────────────────────────────────
router.get('/customers', requireAdmin, async (req, res) => {
  try {
    const [customers, steps] = await Promise.all([db.listOnboardingCustomers(), db.listOnboardingSteps(true)]);
    res.json({ customers, steps });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาด' }); }
});
router.post('/customers', requireAdmin, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'อีเมลไม่ถูกต้อง' });
  try {
    const id = await db.addOnboardingCustomer({
      email, name: req.body.name, contact: req.body.contact, note: req.body.note,
      added_by: req.user.email,
    });
    res.json({ ok: true, id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'บันทึกไม่สำเร็จ' }); }
});
router.patch('/customers/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid' });
  try { const ok = await db.updateOnboardingCustomer(id, req.body); res.json({ ok }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'บันทึกไม่สำเร็จ' }); }
});
router.delete('/customers/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid' });
  try { await db.deleteOnboardingCustomer(id); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'ลบไม่สำเร็จ' }); }
});
// Manual admin override of a step (before the API feed is wired up).
router.patch('/customers/:id/step/:stepId', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10), stepId = parseInt(req.params.stepId, 10);
  if (!id || !stepId) return res.status(400).json({ error: 'invalid' });
  try { await db.setOnboardingProgress(id, stepId, !!req.body.done); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'บันทึกไม่สำเร็จ' }); }
});

// ── POST /api/onboarding/sync  (sync key) — the future automatic data feed ──────
// Body: { updates: [{ email, step_key, done }] }  — done defaults to true.
// Only updates customers already added by admin; unknown email/step_key is skipped.
router.post('/sync', requireSyncKey, async (req, res) => {
  const updates = Array.isArray(req.body.updates) ? req.body.updates : [];
  try {
    let matched = 0;
    for (const u of updates) {
      const done = u.done === undefined ? true : !!u.done;
      if (await db.setOnboardingProgressByKey(u.email, u.step_key, done)) matched++;
    }
    res.json({ ok: true, matched, total: updates.length });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Sync failed.' }); }
});

module.exports = router;
