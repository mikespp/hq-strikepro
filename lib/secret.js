// AES-256-GCM for investor passwords at rest.
//
// Key source: PORTFOLIO_ENC_KEY (64 hex chars = 32 bytes) if set, otherwise a
// key derived from JWT_SECRET so encryption works out of the box on deploy.
// Stored format: base64(iv[12] | ciphertext | tag[16]).
const crypto = require('crypto');

function key() {
  const hex = process.env.PORTFOLIO_ENC_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  return crypto.scryptSync(String(process.env.JWT_SECRET || 'hq-portfolio'), 'pf-enc-v1', 32);
}

function encrypt(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64');
}

function decrypt(blob) {
  if (!blob) return '';
  try {
    const buf = Buffer.from(String(blob), 'base64');
    const iv = buf.subarray(0, 12), tag = buf.subarray(buf.length - 16), ct = buf.subarray(12, buf.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch { return ''; }
}

module.exports = { encrypt, decrypt };
