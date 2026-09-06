const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAdmin, requireSuperAdmin } = require('./auth');

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
// Step definitions may be changed by the OWNER (super admin) only.
router.post('/steps', requireSuperAdmin, async (req, res) => {
  const label = String(req.body.label || '').trim();
  if (!label) return res.status(400).json({ error: 'กรุณากรอกชื่อขั้นตอน' });
  try { const id = await db.addOnboardingStep({ label, step_key: req.body.step_key, sort_order: req.body.sort_order });
    res.json({ ok: true, id }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'บันทึกไม่สำเร็จ' }); }
});
router.patch('/steps/:id', requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid' });
  try { const ok = await db.updateOnboardingStep(id, req.body);
    res.json({ ok }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'บันทึกไม่สำเร็จ' }); }
});
router.delete('/steps/:id', requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid' });
  try { await db.deleteOnboardingStep(id); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'ลบไม่สำเร็จ' }); }
});
// Reorder: body { order: [id, id, ...] } — renumbers all steps 1..N.
router.post('/steps/reorder', requireSuperAdmin, async (req, res) => {
  const order = (Array.isArray(req.body.order) ? req.body.order : []).map(x => parseInt(x, 10)).filter(Boolean);
  if (!order.length) return res.status(400).json({ error: 'invalid' });
  try { await db.reorderOnboardingSteps(order); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'จัดลำดับไม่สำเร็จ' }); }
});

// ── Customers ───────────────────────────────────────────────────────────────────
router.get('/customers', requireAdmin, async (req, res) => {
  try {
    const [customers, steps] = await Promise.all([db.listOnboardingCustomers(), db.listOnboardingSteps(true)]);
    res.json({ customers, steps, oaEnabled: !!process.env.LINE_OA_TOKEN });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาด' }); }
});

// Send a LINE message to a customer via the OA (Messaging API push). Needs the
// customer linked (line_user_id), LINE_OA_TOKEN set, and the OA + Login channel
// in the same provider so the userId matches. Push works only if they added the OA.
router.post('/customers/:id/line-message', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const text = String(req.body.text || '').trim();
  if (!id || !text) return res.status(400).json({ error: 'กรุณากรอกข้อความ' });
  const token = process.env.LINE_OA_TOKEN;
  if (!token) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า OA (LINE_OA_TOKEN)' });
  try {
    const cust = await db.getOnboardingCustomerById(id);
    if (!cust) return res.status(404).json({ error: 'ไม่พบลูกค้า' });
    const user = await db.findUserByEmail(cust.email);
    const lineUserId = user && user.line_user_id;
    if (!lineUserId) return res.status(400).json({ error: 'ลูกค้ายังไม่ได้ผูก LINE' });

    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
    });
    if (!r.ok) {
      let detail = ''; try { const b = await r.json(); detail = b.message || ''; } catch {}
      console.error('LINE push failed:', r.status, detail);
      const msg = r.status === 400 ? 'ส่งไม่สำเร็จ — ลูกค้าอาจยังไม่ได้แอดเพื่อน OA หรือ userId ไม่ตรง provider'
        : ('ส่งไม่สำเร็จ (' + r.status + ')');
      return res.status(502).json({ error: msg + (detail ? ' — ' + detail : '') });
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'ส่งไม่สำเร็จ' }); }
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

// ── GET /api/onboarding/emails  (sync key) — VPS pulls the customer email list ──
// So the VPS auto-sync can look up each customer's KYC level / balance in B2.
router.get('/emails', requireSyncKey, async (req, res) => {
  try { res.json(await db.listOnboardingEmails()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Failed.' }); }
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
