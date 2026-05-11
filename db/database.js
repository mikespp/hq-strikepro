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

async function getDashboardStats(userId) {
  const [rows] = await pool.execute(
    `SELECT
       COUNT(*) AS total_clients,
       SUM(CASE WHEN JSON_CONTAINS(activities, '"Product Talk"')       THEN 1 ELSE 0 END) AS product_talk,
       SUM(CASE WHEN JSON_CONTAINS(activities, '"Unlock Your Wealth"') THEN 1 ELSE 0 END) AS unlock_your_wealth,
       SUM(CASE WHEN JSON_CONTAINS(activities, '"Introduction to HQ"') THEN 1 ELSE 0 END) AS introduction_to_hq,
       SUM(CASE WHEN JSON_CONTAINS(activities, '"Office Visit"')       THEN 1 ELSE 0 END) AS office_visit,
       SUM(CASE WHEN JSON_CONTAINS(activities, '"SBC"')                THEN 1 ELSE 0 END) AS sbc,
       SUM(CASE WHEN (ppvp_usd > 0 OR hq_ultimate_usd > 0 OR golden_boy_usd > 0 OR self_trade_usd > 0)
                THEN 1 ELSE 0 END)                                                        AS invested
     FROM clients
     WHERE user_id = ?`,
    [userId]
  );
  const r = rows[0];
  return {
    total_clients:      Number(r.total_clients)      || 0,
    product_talk:       Number(r.product_talk)       || 0,
    unlock_your_wealth: Number(r.unlock_your_wealth) || 0,
    introduction_to_hq: Number(r.introduction_to_hq) || 0,
    office_visit:       Number(r.office_visit)       || 0,
    sbc:                Number(r.sbc)                || 0,
    invested:           Number(r.invested)           || 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  init,
  findUserByEmail, findUserById, createUser,
  createSession, findSession, deleteSession,
  getAllClients, getClientById, createClient, updateClient, deleteClient,
  getDashboardStats,
};
