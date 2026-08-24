// Transactional email for OTP codes.
// Priority: Brevo HTTP API (BREVO_API_KEY) → Resend (RESEND_API_KEY) → Gmail SMTP → dev log.
// HTTP APIs are tried first because hosts like Railway block outbound SMTP ports.

const GMAIL_USER = process.env.GMAIL_USER || '';
// Google shows the app password as 4 groups of 4 with spaces — strip them.
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const BREVO_API_KEY  = process.env.BREVO_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM ||
  (GMAIL_USER ? `HQ Strikepro <${GMAIL_USER}>` : 'HQ Strikepro <onboarding@resend.dev>');

// Parse "Name <email@x>" (or a bare email) into { name, email }
function parseFrom(from) {
  const m = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(from);
  if (m) return { name: m[1] || 'HQ Strikepro', email: m[2] };
  return { name: 'HQ Strikepro', email: (from || '').trim() };
}

async function sendViaBrevo(to, subject, html) {
  const from = parseFrom(MAIL_FROM);
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: from.name, email: from.email }, to: [{ email: to }], subject, htmlContent: html }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Brevo ${r.status}: ${body}`);
  }
  return { via: 'brevo', ...(await r.json().catch(() => ({}))) };
}

let _transporter = null;
function gmailTransport() {
  if (_transporter) return _transporter;
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    const nodemailer = require('nodemailer');
    _transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,            // submission port (STARTTLS) — more likely open than 465
      secure: false,
      requireTLS: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      family: 4,            // force IPv4 (Railway IPv6 → Gmail is unreachable)
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 20000, // fail fast instead of hanging
    });
  }
  return _transporter;
}

function otpHtml(code) {
  return `
  <div style="font-family:'IBM Plex Sans Thai',-apple-system,Segoe UI,sans-serif;background:#0d0d0d;padding:32px;color:#f1f1f1">
    <div style="max-width:440px;margin:0 auto;background:#1a1a1a;border:1px solid #2e2e2e;border-radius:14px;overflow:hidden">
      <div style="height:3px;background:linear-gradient(90deg,transparent,#d4af37,transparent)"></div>
      <div style="padding:28px 26px">
        <div style="font-size:18px;font-weight:800">HQ <span style="color:#E63946">STRIKEPRO</span></div>
        <p style="color:#aaa;font-size:14px;margin:16px 0 6px">รหัสยืนยันการสมัครสมาชิกของคุณคือ</p>
        <div style="font-size:38px;font-weight:900;letter-spacing:8px;color:#d4af37;margin:8px 0 14px">${code}</div>
        <p style="color:#777;font-size:13px;line-height:1.6;margin:0">
          รหัสนี้ใช้ได้ภายใน <b style="color:#f1f1f1">10 นาที</b> · กรอกในหน้าสมัครเพื่อดำเนินการต่อ<br>
          หากคุณไม่ได้เป็นผู้ขอสมัคร กรุณาเพิกเฉยต่ออีเมลนี้
        </p>
      </div>
    </div>
  </div>`;
}

async function sendViaResend(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Resend ${r.status}: ${body}`);
  }
  return { via: 'resend', ...(await r.json().catch(() => ({}))) };
}

// Generic sender — tries HTTP APIs first (SMTP is blocked on hosts like Railway),
// then Gmail SMTP. Throws if every configured provider fails.
async function sendMail(to, subject, html) {
  const providers = [];
  if (BREVO_API_KEY)  providers.push(['Brevo',  () => sendViaBrevo(to, subject, html)]);
  if (RESEND_API_KEY) providers.push(['Resend', () => sendViaResend(to, subject, html)]);
  const t = gmailTransport();
  if (t) providers.push(['Gmail', async () => { await t.sendMail({ from: MAIL_FROM, to, subject, html }); return { via: 'gmail' }; }]);

  const errors = [];
  for (const [name, send] of providers) {
    try {
      return await send();
    } catch (e) {
      const detail = e.responseCode ? `${e.responseCode} ${e.message}` : e.message;
      console.error(`[mailer] ${name} send failed for ${to}: ${detail}`);
      errors.push(`${name}: ${detail}`);
    }
  }
  if (providers.length) throw new Error(errors.join(' | '));

  console.log(`\n  📧 [DEV] mail to ${to} — "${subject}" (no mail provider configured — not sent)\n`);
  return { dev: true };
}

async function sendOtpEmail(to, code) {
  const res = await sendMail(to, `รหัสยืนยัน HQ Strikepro: ${code}`, otpHtml(code));
  if (res.dev) console.log(`  📧 [DEV] OTP for ${to}: ${code}`);
  return res;
}

function discordVerifyHtml(link, username) {
  const who = username ? ` (${username})` : '';
  return `
  <div style="font-family:'IBM Plex Sans Thai',-apple-system,Segoe UI,sans-serif;background:#0d0d0d;padding:32px;color:#f1f1f1">
    <div style="max-width:460px;margin:0 auto;background:#1a1a1a;border:1px solid #2e2e2e;border-radius:14px;overflow:hidden">
      <div style="height:3px;background:linear-gradient(90deg,transparent,#5865F2,transparent)"></div>
      <div style="padding:28px 26px">
        <div style="font-size:18px;font-weight:800">HQ <span style="color:#E63946">STRIKEPRO</span></div>
        <p style="color:#aaa;font-size:14px;margin:16px 0 6px">ยืนยันบัญชี Discord${who} ว่าเป็นลูกค้า StrikePro</p>
        <p style="color:#ccc;font-size:14px;line-height:1.7;margin:0 0 18px">กดปุ่มด้านล่างเพื่อรับยศใน Discord — ลิงก์นี้ใช้ได้ครั้งเดียว ภายใน <b style="color:#f1f1f1">30 นาที</b></p>
        <a href="${link}" style="display:inline-block;background:#5865F2;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;font-size:15px">✅ ยืนยัน & รับยศ Discord</a>
        <p style="color:#777;font-size:12px;line-height:1.6;margin:18px 0 0">ถ้าปุ่มกดไม่ได้ คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:<br><span style="color:#8a8fd8;word-break:break-all">${link}</span></p>
        <p style="color:#777;font-size:12px;line-height:1.6;margin:14px 0 0">หากคุณไม่ได้เป็นผู้ขอยืนยัน กรุณาเพิกเฉยต่ออีเมลนี้</p>
      </div>
    </div>
  </div>`;
}
async function sendDiscordVerifyEmail(to, link, username) {
  return sendMail(to, 'ยืนยันบัญชี Discord กับ HQ Strikepro', discordVerifyHtml(link, username));
}

// Live check of the active provider (validates the API key / SMTP creds)
async function verifyMailer() {
  const from = parseFrom(MAIL_FROM);
  // Brevo — validate the API key against the account endpoint
  if (BREVO_API_KEY) {
    try {
      const r = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': BREVO_API_KEY, accept: 'application/json' } });
      if (!r.ok) return { provider: 'brevo', from: from.email, ok: false, error: `${r.status} ${await r.text().catch(() => '')}` };
      return { provider: 'brevo', from: from.email, ok: true, note: 'ต้อง verify อีเมลผู้ส่งนี้ใน Brevo → Senders ก่อนส่งจริง' };
    } catch (e) {
      return { provider: 'brevo', from: from.email, ok: false, error: e.message };
    }
  }
  if (RESEND_API_KEY) return { provider: 'resend', from: from.email, ok: true, note: 'Resend has no live verify — test by sending' };
  const t = gmailTransport();
  if (t) {
    try { await t.verify(); return { provider: 'gmail', user: GMAIL_USER, ok: true }; }
    catch (e) { return { provider: 'gmail', user: GMAIL_USER, ok: false, error: `${e.responseCode || e.code || ''} ${e.message}`.trim() }; }
  }
  return { provider: 'none', ok: false, error: 'ไม่ได้ตั้งค่า mail provider ใด ๆ' };
}

// Which provider is active, for a startup diagnostic
function mailerStatus() {
  const list = [];
  if (BREVO_API_KEY)  list.push('Brevo (HTTP)');
  if (RESEND_API_KEY) list.push('Resend (HTTP)');
  if (GMAIL_USER && GMAIL_APP_PASSWORD) list.push(`Gmail SMTP (${GMAIL_USER})`);
  if (!list.length) return 'NONE — OTP emails will NOT be sent (dev log only). Set BREVO_API_KEY (recommended) / RESEND_API_KEY / Gmail.';
  return list.join(' → ') + `  ·  from: ${parseFrom(MAIL_FROM).email}`;
}

module.exports = { sendOtpEmail, sendMail, sendDiscordVerifyEmail, mailerStatus, verifyMailer };
