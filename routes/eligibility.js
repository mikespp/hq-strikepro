const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');

const router = express.Router();

function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ── POST /api/eligibility/sync ────────────────────────────────────────────────
// Body: { hashes: ["<sha256 hex>", ...] }  — SHA-256 of each normalised customer email.
// Auth: header X-Sync-Key must match process.env.ELIGIBILITY_SYNC_KEY.
router.post('/sync', async (req, res) => {
  const key = process.env.ELIGIBILITY_SYNC_KEY;
  const provided = req.get('X-Sync-Key');
  if (!key || !provided || !safeEqual(provided, key))
    return res.status(401).json({ error: 'Unauthorized' });

  const raw = Array.isArray(req.body.hashes) ? req.body.hashes : null;
  if (!raw) return res.status(400).json({ error: 'hashes[] required' });

  const hashes = [...new Set(raw.filter(h => typeof h === 'string' && /^[a-f0-9]{64}$/i.test(h)).map(h => h.toLowerCase()))];
  try {
    const added = await db.addEligibleHashes(hashes);
    // Auto-upgrade any existing members whose email is now in the allowlist.
    const verified = await db.refreshVerifiedFromEligible();
    const total = await db.countEligible();
    res.json({ ok: true, received: hashes.length, added, verified, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sync failed.' });
  }
});

// ── GET /api/eligibility/status ───────────────────────────────────────────────
router.get('/status', async (req, res) => {
  const key = process.env.ELIGIBILITY_SYNC_KEY;
  const provided = req.get('X-Sync-Key');
  if (!key || !provided || !safeEqual(provided, key))
    return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ total: await db.countEligible() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed.' });
  }
});

module.exports = router;
