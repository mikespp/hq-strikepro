/**
 * MySQL database via mysql2/promise (connection pool, async/await).
 * Config read from environment variables (see .env).
 *
 * Arrays (activities, prev_investments, follow_up) stored as JSON strings.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'hq_strikepro',
  waitForConnections: true,
  connectionLimit:    10,
  charset:            'utf8mb4',
  enableKeepAlive:    true,
  keepAliveInitialDelay: 0,
});

// ── Schema bootstrap ──────────────────────────────────────────────────────────

async function init() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id         INT UNSIGNED    NOT NULL AUTO_INCREMENT PRIMARY KEY,
      email      VARCHAR(255)    NOT NULL UNIQUE,
      password   VARCHAR(255)    NOT NULL,
      created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         INT UNSIGNED    NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id    INT UNSIGNED    NOT NULL,
      token_jti  VARCHAR(128)    NOT NULL UNIQUE,
      created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME        NOT NULL,
      INDEX idx_jti (token_jti)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clients (
      id                      INT UNSIGNED    NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id                 INT UNSIGNED    NOT NULL,
      name                    VARCHAR(255)    NOT NULL,
      phone                   VARCHAR(50)     DEFAULT '',
      email                   VARCHAR(255)    DEFAULT '',
      line_id                 VARCHAR(100)    DEFAULT '',
      channel                 VARCHAR(100)    DEFAULT '',
      activities              TEXT,
      prev_investments        TEXT,
      investment_reason       TEXT,
      expected_profit_pct     DOUBLE          DEFAULT NULL,
      expected_monthly_profit DOUBLE          DEFAULT NULL,
      estimated_capital       DOUBLE          DEFAULT NULL,
      ppvp_usd                DOUBLE          DEFAULT 0,
      hq_ultimate_usd         DOUBLE          DEFAULT 0,
      golden_boy_usd          DOUBLE          DEFAULT 0,
      self_trade_usd          DOUBLE          DEFAULT 0,
      not_invested_reason     TEXT,
      follow_up               TEXT,
      notes                   TEXT,
      created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user_stats (
      user_id             INT UNSIGNED NOT NULL PRIMARY KEY,
      total_clients       INT UNSIGNED NOT NULL DEFAULT 0,
      product_talk        INT UNSIGNED NOT NULL DEFAULT 0,
      unlock_your_wealth  INT UNSIGNED NOT NULL DEFAULT 0,
      introduction_to_hq  INT UNSIGNED NOT NULL DEFAULT 0,
      office_visit        INT UNSIGNED NOT NULL DEFAULT 0,
      sbc                 INT UNSIGNED NOT NULL DEFAULT 0,
      invested            INT UNSIGNED NOT NULL DEFAULT 0,
      updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS reviews (
      id          INT UNSIGNED     NOT NULL AUTO_INCREMENT PRIMARY KEY,
      reviewer    VARCHAR(255)     NOT NULL,
      product     VARCHAR(100)     NOT NULL DEFAULT '',
      rating      TINYINT UNSIGNED NOT NULL,
      message     TEXT             NOT NULL,
      image_data  MEDIUMTEXT       DEFAULT NULL,
      featured    TINYINT(1)       NOT NULL DEFAULT 0,
      created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Add role column to users if it doesn't exist yet (idempotent migration)
  try {
    await pool.execute(`ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'`);
  } catch (err) {
    if (err.errno !== 1060) throw err; // 1060 = duplicate column — already exists, ignore
  }

  // Purge expired sessions on startup
  await pool.execute('DELETE FROM sessions WHERE expires_at <= NOW()');

  console.log('  MySQL connected & schema ready.\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseClient(row) {
  if (!row) return null;
  return {
    ...row,
    activities:       JSON.parse(row.activities       || '[]'),
    prev_investments: JSON.parse(row.prev_investments || '[]'),
    follow_up:        JSON.parse(row.follow_up        || '[]'),
  };
}

function serializeArrays(data) {
  return {
    ...data,
    activities:       JSON.stringify(Array.isArray(data.activities)       ? data.activities       : []),
    prev_investments: JSON.stringify(Array.isArray(data.prev_investments) ? data.prev_investments : []),
    follow_up:        JSON.stringify(Array.isArray(data.follow_up)        ? data.follow_up        : []),
  };
}

// ── Users ─────────────────────────────────────────────────────────────────────

async function findUserByEmail(email) {
  const [rows] = await pool.execute(
    'SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
    [email.trim()]
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function createUser(email, hashedPassword) {
  const [result] = await pool.execute(
    'INSERT INTO users (email, password) VALUES (?, ?)',
    [email.toLowerCase().trim(), hashedPassword]
  );
  return { id: result.insertId, email: email.toLowerCase().trim() };
}

// ── Sessions ──────────────────────────────────────────────────────────────────

async function createSession(userId, tokenJti, expiresAt) {
  await pool.execute(
    'INSERT INTO sessions (user_id, token_jti, expires_at) VALUES (?, ?, ?)',
    [userId, tokenJti, new Date(expiresAt)]
  );
}

async function findSession(tokenJti) {
  const [rows] = await pool.execute(
    'SELECT * FROM sessions WHERE token_jti = ? AND expires_at > NOW() LIMIT 1',
    [tokenJti]
  );
  return rows[0] || null;
}

async function deleteSession(tokenJti) {
  await pool.execute('DELETE FROM sessions WHERE token_jti = ?', [tokenJti]);
}

// ── Clients ───────────────────────────────────────────────────────────────────

async function getAllClients(userId) {
  const [rows] = await pool.execute(
    'SELECT * FROM clients WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
  return rows.map(parseClient);
}

async function getClientById(id, userId) {
  const [rows] = await pool.execute(
    'SELECT * FROM clients WHERE id = ? AND user_id = ? LIMIT 1',
    [id, userId]
  );
  return parseClient(rows[0] || null);
}

async function createClient(userId, data) {
  const d = serializeArrays(data);
  const [result] = await pool.execute(
    `INSERT INTO clients (
       user_id, name, phone, email, line_id, channel,
       activities, prev_investments, investment_reason,
       expected_profit_pct, expected_monthly_profit, estimated_capital,
       ppvp_usd, hq_ultimate_usd, golden_boy_usd, self_trade_usd,
       not_invested_reason, follow_up, notes
     ) VALUES (
       ?, ?, ?, ?, ?, ?,
       ?, ?, ?,
       ?, ?, ?,
       ?, ?, ?, ?,
       ?, ?, ?
     )`,
    [
      userId, d.name, d.phone, d.email, d.line_id, d.channel,
      d.activities, d.prev_investments, d.investment_reason,
      d.expected_profit_pct, d.expected_monthly_profit, d.estimated_capital,
      d.ppvp_usd, d.hq_ultimate_usd, d.golden_boy_usd, d.self_trade_usd,
      d.not_invested_reason, d.follow_up, d.notes,
    ]
  );
  return getClientById(result.insertId, userId);
}

async function updateClient(id, userId, data) {
  const existing = await getClientById(id, userId);
  if (!existing) return null;
  const d = serializeArrays(data);
  await pool.execute(
    `UPDATE clients SET
       name=?, phone=?, email=?, line_id=?, channel=?,
       activities=?, prev_investments=?, investment_reason=?,
       expected_profit_pct=?, expected_monthly_profit=?, estimated_capital=?,
       ppvp_usd=?, hq_ultimate_usd=?, golden_boy_usd=?, self_trade_usd=?,
       not_invested_reason=?, follow_up=?, notes=?
     WHERE id=? AND user_id=?`,
    [
      d.name, d.phone, d.email, d.line_id, d.channel,
      d.activities, d.prev_investments, d.investment_reason,
      d.expected_profit_pct, d.expected_monthly_profit, d.estimated_capital,
      d.ppvp_usd, d.hq_ultimate_usd, d.golden_boy_usd, d.self_trade_usd,
      d.not_invested_reason, d.follow_up, d.notes,
      id, userId,
    ]
  );
  return getClientById(id, userId);
}

async function deleteClient(id, userId) {
  const [result] = await pool.execute(
    'DELETE FROM clients WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  return result.affectedRows > 0;
}

// ── Dashboard stats ───────────────────────────────────────────────────────────

/**
 * Recalculate all stats from the clients table and persist them to user_stats.
 * Processing done in Node.js to avoid MySQL JSON function compatibility issues.
 * Call this after any client create / update / delete.
 */
async function refreshUserStats(userId) {
  const [rows] = await pool.execute(
    `SELECT activities, ppvp_usd, hq_ultimate_usd, golden_boy_usd, self_trade_usd
     FROM clients WHERE user_id = ?`,
    [userId]
  );

  const s = {
    total_clients:      rows.length,
    product_talk:       0,
    unlock_your_wealth: 0,
    introduction_to_hq: 0,
    office_visit:       0,
    sbc:                0,
    invested:           0,
  };

  for (const row of rows) {
    let acts = [];
    try { acts = JSON.parse(row.activities || '[]'); } catch {}
    if (!Array.isArray(acts)) acts = [];

    if (acts.includes('Product Talk'))       s.product_talk++;
    if (acts.includes('Unlock Your Wealth')) s.unlock_your_wealth++;
    if (acts.includes('Introduction to HQ')) s.introduction_to_hq++;
    if (acts.includes('Office Visit'))       s.office_visit++;
    if (acts.includes('SBC'))                s.sbc++;
    if ((row.ppvp_usd       > 0) ||
        (row.hq_ultimate_usd > 0) ||
        (row.golden_boy_usd  > 0) ||
        (row.self_trade_usd  > 0)) {
      s.invested++;
    }
  }

  await pool.execute(
    `INSERT INTO user_stats
       (user_id, total_clients, product_talk, unlock_your_wealth,
        introduction_to_hq, office_visit, sbc, invested)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       total_clients       = VALUES(total_clients),
       product_talk        = VALUES(product_talk),
       unlock_your_wealth  = VALUES(unlock_your_wealth),
       introduction_to_hq  = VALUES(introduction_to_hq),
       office_visit        = VALUES(office_visit),
       sbc                 = VALUES(sbc),
       invested            = VALUES(invested)`,
    [userId, s.total_clients, s.product_talk, s.unlock_your_wealth,
     s.introduction_to_hq, s.office_visit, s.sbc, s.invested]
  );
  return s;
}

/**
 * Recalculate stats fresh from the clients table, persist to user_stats, and return.
 * Always reads from source so the dashboard is never stale.
 */
async function getDashboardStats(userId) {
  return refreshUserStats(userId);
}

// ─────────────────────────────────────────────────────────────────────────────

// ── Product stats ─────────────────────────────────────────────────────────────

async function getProductStats(userId) {
  const [rows] = await pool.execute(
    `SELECT
       COUNT(CASE WHEN ppvp_usd       > 0 THEN 1 END) AS ppvp_count,
       COALESCE(SUM(CASE WHEN ppvp_usd       > 0 THEN ppvp_usd       END), 0) AS ppvp_total,
       COUNT(CASE WHEN hq_ultimate_usd > 0 THEN 1 END) AS hq_count,
       COALESCE(SUM(CASE WHEN hq_ultimate_usd > 0 THEN hq_ultimate_usd END), 0) AS hq_total,
       COUNT(CASE WHEN golden_boy_usd  > 0 THEN 1 END) AS gb_count,
       COALESCE(SUM(CASE WHEN golden_boy_usd  > 0 THEN golden_boy_usd  END), 0) AS gb_total
     FROM clients WHERE user_id = ?`,
    [userId]
  );
  const r = rows[0];
  return {
    ppvp:        { count: Number(r.ppvp_count), total: Number(r.ppvp_total) },
    hq_ultimate: { count: Number(r.hq_count),   total: Number(r.hq_total)  },
    golden_boy:  { count: Number(r.gb_count),   total: Number(r.gb_total)  },
  };
}

const PRODUCT_COL = {
  ppvp:        'ppvp_usd',
  hq_ultimate: 'hq_ultimate_usd',
  golden_boy:  'golden_boy_usd',
};

async function getProductInvestors(userId, productKey) {
  const col = PRODUCT_COL[productKey];
  if (!col) return null;
  const [rows] = await pool.execute(
    `SELECT id, name, phone, \`${col}\` AS amount
     FROM clients
     WHERE user_id = ? AND \`${col}\` > 0
     ORDER BY \`${col}\` DESC`,
    [userId]
  );
  return rows.map(r => ({ id: Number(r.id), name: r.name, phone: r.phone || '', amount: Number(r.amount) }));
}

// ── Reviews ───────────────────────────────────────────────────────────────────

async function createReview({ reviewer, product, rating, message, image_data }) {
  const [result] = await pool.execute(
    'INSERT INTO reviews (reviewer, product, rating, message, image_data) VALUES (?, ?, ?, ?, ?)',
    [reviewer, product || '', rating, message, image_data || null]
  );
  return result.insertId;
}

async function listReviews() {
  const [rows] = await pool.execute(
    'SELECT id, reviewer, product, rating, message, image_data, featured, created_at FROM reviews ORDER BY featured DESC, created_at DESC'
  );
  return rows;
}

async function deleteReview(id) {
  const [result] = await pool.execute('DELETE FROM reviews WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function toggleReviewFeatured(id) {
  await pool.execute('UPDATE reviews SET featured = NOT featured WHERE id = ?', [id]);
  const [rows] = await pool.execute('SELECT featured FROM reviews WHERE id = ?', [id]);
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  init,
  findUserByEmail, findUserById, createUser,
  createSession, findSession, deleteSession,
  getAllClients, getClientById, createClient, updateClient, deleteClient,
  getDashboardStats, refreshUserStats,
  getProductStats, getProductInvestors,
  createReview, listReviews, deleteReview, toggleReviewFeatured,
};
