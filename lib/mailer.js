// Transactional email via Resend (https://resend.com) using the built-in fetch.
// If RESEND_API_KEY is not set, the code is logged to the console instead of sent
// (handy for local dev / testing without an email provider).

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'HQ Strikepro <onboarding@resend.dev>';

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

async function sendOtpEmail(to, code) {
  const subject = `รหัสยืนยัน HQ Strikepro: ${code}`;
  if (!RESEND_API_KEY) {
    console.log(`\n  📧 [DEV] OTP for ${to}: ${code}  (RESEND_API_KEY not set — email not sent)\n`);
    return { dev: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html: otpHtml(code) }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Resend ${r.status}: ${body}`);
  }
  return r.json();
}

module.exports = { sendOtpEmail };
