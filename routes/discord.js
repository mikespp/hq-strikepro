// Magic-link landing for Discord verification.
// GET /api/discord/verify?token=...  → validate token, record the mapping,
// grant the Discord role, and show a result page.

const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');
const { consumeToken } = require('../lib/discord-verify');
const { requireAdmin } = require('./auth');
const bot = require('../lib/discord-bot');

const router = express.Router();
const ROLE_ID = process.env.DISCORD_VERIFIED_ROLE_ID || '';

function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
function requireSyncKey(req, res, next) {
  const key = process.env.ELIGIBILITY_SYNC_KEY;
  const provided = req.get('X-Sync-Key');
  if (!key || !provided || !safeEqual(provided, key)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Grant event roles the email already qualifies for. Each grant is best-effort
// (a missing role id or a Discord error never breaks verification).
async function backfillEventRoles(guildId, discordId, email) {
  const grants = [
    { roleId: process.env.DISCORD_LAST_ACCOUNT_ROLE_ID, has: () => db.emailInLastAccount(email) },
    { roleId: process.env.DISCORD_THE_LAST_DAY_ROLE_ID, has: () => db.emailInTheLastDay(email) },
  ];
  for (const g of grants) {
    if (!g.roleId) continue;
    try { if (await g.has()) await bot.grantRole(guildId, discordId, g.roleId); }
    catch (e) { console.error('backfill role failed:', e.message); }
  }
}

function page(title, msg, color) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;800&display=swap" rel="stylesheet">
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;
background:#0d0d0d;color:#f1f1f1;font-family:'IBM Plex Sans Thai',system-ui,sans-serif}
.card{max-width:420px;margin:16px;background:#1a1a1a;border:1px solid #2e2e2e;border-radius:16px;overflow:hidden;text-align:center}
.bar{height:4px;background:${color}}.in{padding:34px 28px}.t{font-size:22px;font-weight:800;margin:0 0 10px;color:${color}}
.m{color:#cbd5e1;font-size:15px;line-height:1.7;margin:0}.b{margin-top:20px;font-size:13px;color:#777}</style></head>
<body><div class="card"><div class="bar"></div><div class="in"><h1 class="t">${title}</h1><p class="m">${msg}</p>
<div class="b">HQ · STRIKEPRO</div></div></div></body></html>`;
}

router.get('/verify', async (req, res) => {
  const token = String(req.query.token || '');
  let payload;
  try { payload = consumeToken(token); }
  catch (e) {
    return res.status(400).send(page('ลิงก์ไม่ถูกต้อง ❌', 'ลิงก์หมดอายุหรือไม่ถูกต้อง กรุณากดยืนยันใหม่ใน Discord', '#ef4444'));
  }
  try {
    await db.upsertDiscordVerification(payload.discordId, payload.email, payload.username, payload.guildId);
    await bot.grantRole(payload.guildId, payload.discordId, ROLE_ID);
    // Back-fill event roles the user already earned (joined before verifying Discord).
    await backfillEventRoles(payload.guildId, payload.discordId, payload.email);
    return res.send(page('ยืนยันสำเร็จ ✅', 'คุณได้รับยศใน Discord เรียบร้อยแล้ว — กลับไปที่ Discord ได้เลย', '#22c55e'));
  } catch (e) {
    console.error('discord verify finalize failed:', e.message);
    return res.status(500).send(page('ยืนยันอีเมลแล้ว ⚠️',
      'ระบบยืนยันอีเมลของคุณแล้ว แต่ให้ยศอัตโนมัติไม่สำเร็จ กรุณาแจ้งแอดมิน (หรือลองกดลิงก์อีกครั้ง)', '#f59e0b'));
  }
});

// ── Admin lookup ───────────────────────────────────────────────────────────────
// GET /api/discord/list                → all verified mappings (admin)
router.get('/list', requireAdmin, async (req, res) => {
  try { res.json(await db.listDiscordVerifications()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
});
// GET /api/discord/lookup?email=  or  ?discord=   → one mapping (admin)
router.get('/lookup', requireAdmin, async (req, res) => {
  try {
    const email = String(req.query.email || '').toLowerCase().trim();
    const did   = String(req.query.discord || '').trim();
    if (email) return res.json((await db.getDiscordByEmail(email)) || {});
    if (did)   return res.json((await db.getDiscordVerification(did)) || {});
    res.status(400).json({ error: 'email or discord required' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
});
// GET /api/discord/sync-list  (sync key)  → for the VPS dashboard bridge
router.get('/sync-list', requireSyncKey, async (req, res) => {
  try { res.json(await db.listDiscordVerifications()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
});

module.exports = router;
