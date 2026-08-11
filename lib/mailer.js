// Transactional email for OTP codes.
// Priority: Gmail SMTP (GMAIL_USER + GMAIL_APP_PASSWORD) → Resend (RESEND_API_KEY)
// → dev console log (when nothing is configured — handy for local testing).

const GMAIL_USER = process.env.GMAIL_USER || '';
// Google shows the app password as 4 groups of 4 with spaces — strip them.
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM ||
  (GMAIL_USER ? `HQ Strikepro <${GMAIL_USER}>` : 'HQ Strikepro <onboarding@resend.dev>');

let _transporter = null;
function gmailTransport() {
  if (_transporter) return _transporter;
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    const nodemailer = require('nodemailer');
    _transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      family: 4, // force IPv4 (Railway IPv6 → Gmail is unreachable)
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

async function sendOtpEmail(to, code) {
  const subject = `รหัสยืนยัน HQ Strikepro: ${code}`;
  const html = otpHtml(code);

  // 1) Gmail SMTP (fall through to Resend if it fails and Resend is configured)
  const t = gmailTransport();
  if (t) {
    try {
      await t.sendMail({ from: MAIL_FROM, to, subject, html });
      return { via: 'gmail' };
    } catch (e) {
      // Surface the real SMTP reason in the logs (auth failures show responseCode 535, etc.)
      console.error(`[mailer] Gmail send failed for ${to}:`, e.responseCode || e.code || '', e.message);
      if (!RESEND_API_KEY) throw new Error(`Gmail: ${e.message}`);
      console.warn('[mailer] falling back to Resend…');
    }
  }

  // 2) Resend
  if (RESEND_API_KEY) {
    try {
      return await sendViaResend(to, subject, html);
    } catch (e) {
      console.error(`[mailer] Resend send failed for ${to}:`, e.message);
      throw e;
    }
  }

  // 3) dev fallback — nothing configured
  console.log(`\n  📧 [DEV] OTP for ${to}: ${code}  (no mail provider configured — email not sent)\n`);
  return { dev: true };
}

// Live check of the SMTP credentials (surfaces the real auth error without sending)
async function verifyMailer() {
  const t = gmailTransport();
  if (t) {
    try {
      await t.verify();
      return { provider: 'gmail', user: GMAIL_USER, ok: true };
    } catch (e) {
      return { provider: 'gmail', user: GMAIL_USER, ok: false,
        error: `${e.responseCode || e.code || ''} ${e.message}`.trim() };
    }
  }
  if (RESEND_API_KEY) {
    return { provider: 'resend', ok: true, note: 'Resend has no live verify — test by sending' };
  }
  return { provider: 'none', ok: false, error: 'ไม่ได้ตั้งค่า mail provider ใด ๆ' };
}

// Which provider is active, for a startup diagnostic
function mailerStatus() {
  if (GMAIL_USER && GMAIL_APP_PASSWORD) return `Gmail SMTP (${GMAIL_USER})` + (RESEND_API_KEY ? ' + Resend fallback' : '');
  if (RESEND_API_KEY) return 'Resend';
  return 'NONE — OTP emails will NOT be sent (dev log only). Set GMAIL_USER+GMAIL_APP_PASSWORD or RESEND_API_KEY.';
}

module.exports = { sendOtpEmail, mailerStatus, verifyMailer };
