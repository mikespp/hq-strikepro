// Who may manage membership badge numbers (the 🏅 assign/import feature).
// This is a narrow permission — a badge manager can assign numbers but has NONE
// of the other admin powers (no deleting users, changing roles, or resetting
// passwords). Super-admins always qualify. Extra managers can be added in code
// below or via the BADGE_MANAGER_EMAILS env (comma-separated), same pattern as
// lib/super-admin.js so the list can't be lifted from the DB/UI.
const { isSuperAdmin } = require('./super-admin');

const DEFAULT_MANAGERS = ['chontiwa001@gmail.com'];

const envEmails = (process.env.BADGE_MANAGER_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

const MANAGERS = new Set([...DEFAULT_MANAGERS.map(e => e.toLowerCase()), ...envEmails]);

function canManageBadges(email) {
  const e = String(email || '').trim().toLowerCase();
  return isSuperAdmin(e) || MANAGERS.has(e);
}

module.exports = { canManageBadges, list: () => [...MANAGERS] };
