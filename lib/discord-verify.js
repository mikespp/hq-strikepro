// Shared Discord email-verification logic (magic-link flow).
// Reuses checkEligible (live customer check via the VPS) and the mailer.
// A signed JWT is the magic-link token — stateless, single 30-min expiry.

const jwt = require('jsonwebtoken');
const db  = require('../db/database');
const { checkEligible } = require('../routes/auth');
const { sendDiscordVerifyEmail } = require('./mailer');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://hq-strikepro-production.up.railway.app').replace(/\/$/, '');
const TOKEN_TTL = 30 * 60; // seconds

const norm = e => String(e || '').toLowerCase().trim();
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Check the email is a StrikePro customer, then email a magic link.
// Returns { sent:true } or { sent:false, reason }.
async function requestVerify({ discordId, username, email, guildId }) {
  email = norm(email);
  if (!discordId || !isEmail(email)) return { sent: false, reason: 'bad_input' };

  let eligible = false;
  try { eligible = await checkEligible(email); }
  catch (e) { console.error('discord checkEligible failed:', e.message); return { sent: false, reason: 'service' }; }
  if (!eligible) return { sent: false, reason: 'not_customer' };

  // one email may verify only one Discord account
  const existing = await db.getDiscordByEmail(email);
  if (existing && String(existing.discord_id) !== String(discordId)) return { sent: false, reason: 'email_taken' };

  const token = jwt.sign(
    { p: 'discord_verify', d: String(discordId), e: email, g: String(guildId || ''), u: String(username || '') },
    JWT_SECRET, { expiresIn: TOKEN_TTL }
  );
  const link = `${PUBLIC_BASE_URL}/api/discord/verify?token=${encodeURIComponent(token)}`;
  await sendDiscordVerifyEmail(email, link, username);
  return { sent: true };
}

// Decode + validate a magic-link token. Throws if invalid/expired.
function consumeToken(token) {
  const d = jwt.verify(token, JWT_SECRET);
  if (d.p !== 'discord_verify') throw new Error('wrong token purpose');
  return { discordId: d.d, email: d.e, guildId: d.g, username: d.u };
}

module.exports = { requestVerify, consumeToken };
