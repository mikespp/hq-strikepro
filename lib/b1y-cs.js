// Who may reserve ("ติ๊กจอง") a Bussay 1 Year subscriber on the CS page.
// Only these four CS members (and super-admins) can reserve; other admins can
// view the list but not reserve. Each reserver is recorded under their name.
// Extra reservers can be added via B1Y_RESERVERS env ("email:Name,email:Name").
const { isSuperAdmin } = require('./super-admin');

const DEFAULT_RESERVERS = {
  'pinitchai.junbunmee@gmail.com': 'Di',
  'rock.sarayu@gmail.com':        'Rock',
  'chontiwa001@gmail.com':        'Namkang',
  'photsmiss@gmail.com':          'Phot',
};

// env override: "email:Name,email:Name"
const envReservers = {};
(process.env.B1Y_RESERVERS || '').split(',').map(s => s.trim()).filter(Boolean).forEach(pair => {
  const i = pair.indexOf(':');
  if (i > 0) envReservers[pair.slice(0, i).trim().toLowerCase()] = pair.slice(i + 1).trim();
});

const RESERVERS = { ...DEFAULT_RESERVERS, ...envReservers };

// May reserve/release a Bussay 1 Year subscriber. Super-admins always qualify.
function canReserveB1y(email) {
  const e = String(email || '').trim().toLowerCase();
  return isSuperAdmin(e) || Object.prototype.hasOwnProperty.call(RESERVERS, e);
}

// The display name recorded when this user reserves (falls back to the email).
function reserverName(email) {
  const e = String(email || '').trim().toLowerCase();
  return RESERVERS[e] || e;
}

module.exports = { canReserveB1y, reserverName, list: () => ({ ...RESERVERS }) };
