// Protected owner account(s). A super-admin is always promoted to `admin` on
// startup and can never be deleted, demoted, or have its password reset through
// the admin API — not even by another admin. Defined in code (plus an optional
// SUPER_ADMIN_EMAILS env) so the protection can't be lifted from the DB or UI.
const OWNER_EMAILS = ['mike.suppapit@gmail.com'];

const envEmails = (process.env.SUPER_ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

const SUPER_ADMINS = new Set([...OWNER_EMAILS.map(e => e.toLowerCase()), ...envEmails]);

function isSuperAdmin(email) {
  return SUPER_ADMINS.has(String(email || '').trim().toLowerCase());
}

module.exports = { SUPER_ADMINS, isSuperAdmin, list: () => [...SUPER_ADMINS] };
