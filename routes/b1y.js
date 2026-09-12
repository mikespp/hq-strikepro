const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth, requireAdmin } = require('./auth');
const { canReserveB1y, reserverName } = require('../lib/b1y-cs');
const { isSuperAdmin } = require('../lib/super-admin');

const router = express.Router();

// Shared-secret guard for the VPS sync job (reuses ELIGIBILITY_SYNC_KEY).
function requireSyncKey(req, res, next) {
  const key = process.env.ELIGIBILITY_SYNC_KEY;
  const got = req.get('X-Sync-Key') || '';
  const a = Buffer.from(got), b = Buffer.from(key || '');
  if (!key || a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── POST /api/b1y/sync  (sync key) — VPS pushes the full subscriber list ─────────
// Body: { subscribers: [{ account_number, client_id, client_name, email, phone,
//   nickname, country, status, product_name, currency, balance, equity, credit,
//   pnl, available_balance, free_margin, margin, margin_level, update_time }] }
router.post('/sync', requireSyncKey, async (req, res) => {
  const subs = Array.isArray(req.body.subscribers) ? req.body.subscribers : [];
  try {
    const r = await db.replaceB1ySubscribers(subs);
    res.json({ ok: true, count: r.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sync failed.' });
  }
});

// ── GET /api/b1y/subscribers  (admin) — full list + reservation ─────────────────
router.get('/subscribers', requireAdmin, async (req, res) => {
  try {
    res.json(await db.listB1ySubscribers());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

// ── POST /api/b1y/reserve  (member, must be an allowed reserver) ─────────────────
// Body: { account_number, reserve: true|false }. Reserving an empty slot claims it
// under the caller's name; releasing is allowed only for the reserver or a super-admin.
router.post('/reserve', requireAuth, async (req, res) => {
  try {
    const user = await db.findUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'ไม่พบผู้ใช้' });
    const email = String(user.email || '').trim().toLowerCase();
    if (!canReserveB1y(email))
      return res.status(403).json({ error: 'เฉพาะทีม CS ที่กำหนดเท่านั้นที่ติ๊กจองได้' });

    const acc = String(req.body.account_number || '').trim();
    if (!acc) return res.status(400).json({ error: 'ไม่พบเลขบัญชี' });
    const reserve = !!req.body.reserve;

    const existing = await db.getB1yReservation(acc);
    if (reserve) {
      if (existing && existing.reserved_by_email !== email && !isSuperAdmin(email))
        return res.status(409).json({ error: 'จองโดย ' + existing.reserved_by_name + ' แล้ว', code: 'taken', by: existing.reserved_by_name });
      await db.setB1yReservation(acc, email, reserverName(email));
      return res.json({ ok: true, reserved: true, by: reserverName(email), by_email: email });
    } else {
      if (existing && existing.reserved_by_email !== email && !isSuperAdmin(email))
        return res.status(403).json({ error: 'ยกเลิกได้เฉพาะคนที่จอง หรือ Super Admin' });
      await db.clearB1yReservation(acc);
      return res.json({ ok: true, reserved: false });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

module.exports = router;
