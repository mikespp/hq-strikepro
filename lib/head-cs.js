// Who may assign the Account Manager on CS onboarding customers.
// Only the Head CS (and super-admins) can (re)assign an AM — other admins can
// view the CS dashboard and edit notes, but not change the AM. Super-admins can
// do everything. Extra Head-CS emails can be added in code below or via the
// HEAD_CS_EMAILS env (comma-separated), same pattern as lib/super-admin.js.
const { isSuperAdmin } = require('./super-admin');

const DEFAULT_HEAD_CS = ['rock.sarayu@gmail.com'];

const envEmails = (process.env.HEAD_CS_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

const HEAD_CS = new Set([...DEFAULT_HEAD_CS.map(e => e.toLowerCase()), ...envEmails]);

// May assign / reassign an Account Manager. Super-admins always qualify.
function canAssignManager(email) {
  const e = String(email || '').trim().toLowerCase();
  return isSuperAdmin(e) || HEAD_CS.has(e);
}

module.exports = { canAssignManager, list: () => [...HEAD_CS] };
