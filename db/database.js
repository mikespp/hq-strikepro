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

  // บ้านหลังสุดท้าย (The Last Account) — program applications
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS last_account_applications (
      id          INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
      first_name  VARCHAR(120)  NOT NULL,
      last_name   VARCHAR(120)  NOT NULL,
      nickname    VARCHAR(120)  NOT NULL DEFAULT '',
      phone       VARCHAR(50)   NOT NULL DEFAULT '',
      email       VARCHAR(255)  NOT NULL DEFAULT '',
      mt5_account VARCHAR(60)   NOT NULL DEFAULT '',
      line_id     VARCHAR(120)  NOT NULL DEFAULT '',
      discord_id  VARCHAR(120)  NOT NULL DEFAULT '',
      seat_type   VARCHAR(10)   NOT NULL DEFAULT 'main',
      created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Calendar events — single source of truth shared by the homepage calendar
  // and the Calendar Dashboard. Seeded once from db/events-seed.js if empty.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS events (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      title       VARCHAR(255) NOT NULL,
      start_date  DATE         NOT NULL,
      end_date    DATE         NOT NULL,
      color       VARCHAR(20)  NOT NULL DEFAULT '#d4af37',
      href        VARCHAR(255) DEFAULT NULL,
      live        TINYINT(1)   NOT NULL DEFAULT 0,
      created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_start (start_date),
      INDEX idx_end (end_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // The Last Day — editions ("ครั้งที่ N"). Date/time/venue are admin-editable at
  // runtime (opening the next edition), so they live in the DB, not in code.
  // Datetimes are stored as ISO strings WITH the +07:00 offset (unambiguous).
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS the_last_day_editions (
      edition       SMALLINT     NOT NULL PRIMARY KEY,
      label         VARCHAR(60)  NOT NULL,
      opens_at      VARCHAR(40)  NOT NULL,
      event_start   VARCHAR(40)  NOT NULL,
      event_end     VARCHAR(40)  NOT NULL,
      venue         VARCHAR(255) NOT NULL DEFAULT '',
      main_seats    SMALLINT     NOT NULL DEFAULT 30,
      reserve_seats SMALLINT     NOT NULL DEFAULT 10,
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // Seed the current edition (2) once, preserving the previously-hardcoded values.
  {
    const [c] = await pool.execute('SELECT COUNT(*) AS c FROM the_last_day_editions');
    if (Number(c[0].c) === 0) {
      await pool.execute(
        `INSERT INTO the_last_day_editions
           (edition, label, opens_at, event_start, event_end, venue, main_seats, reserve_seats)
         VALUES (2, 'ครั้งที่ 2', '2026-08-20T00:00:00+07:00', '2026-08-23T10:00:00+07:00',
                 '2026-08-23T18:00:00+07:00', 'Strike Pro Head Office', 30, 10)`
      );
    }
  }

  // กินข้าวบ้านจารย์ — recurring dinner "rounds" (date/time/venue only; no seats).
  // The public page never shows the round number; admin does. Counter starts at 3.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS dinner_editions (
      round        SMALLINT     NOT NULL PRIMARY KEY,
      opens_at     VARCHAR(40)  NOT NULL,
      event_start  VARCHAR(40)  NOT NULL,
      event_end    VARCHAR(40)  NOT NULL,
      venue        VARCHAR(255) NOT NULL DEFAULT '',
      created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // กินข้าวบ้านจารย์ — RSVP registrations (one-click join; no seat cap).
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS dinner_registrations (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      round        SMALLINT     NOT NULL DEFAULT 3,
      user_id      INT UNSIGNED NULL,
      first_name   VARCHAR(120) NOT NULL DEFAULT '',
      last_name    VARCHAR(120) NOT NULL DEFAULT '',
      nickname     VARCHAR(120) NOT NULL DEFAULT '',
      phone        VARCHAR(50)  NOT NULL DEFAULT '',
      email        VARCHAR(255) NOT NULL DEFAULT '',
      line_id      VARCHAR(120) NOT NULL DEFAULT '',
      confirmed    TINYINT(1)   NOT NULL DEFAULT 0,
      confirmed_at DATETIME     NULL,
      created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_dinner_round_email (round, email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Fund portfolios — MT5 accounts + their daily equity snapshots (for Myfxbook-
  // style time-weighted returns). Fed by the VPS fetcher that loops each login.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS pf_accounts (
      login      BIGINT       NOT NULL PRIMARY KEY,
      label      VARCHAR(120) NOT NULL DEFAULT '',
      server     VARCHAR(120) NOT NULL DEFAULT '',
      currency   VARCHAR(10)  NOT NULL DEFAULT 'USD',
      active     TINYINT(1)   NOT NULL DEFAULT 1,
      sort_order SMALLINT     NOT NULL DEFAULT 0,
      updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS pf_daily (
      login      BIGINT   NOT NULL,
      d          DATE     NOT NULL,
      balance    DOUBLE   NOT NULL DEFAULT 0,
      equity     DOUBLE   NOT NULL DEFAULT 0,
      deposit    DOUBLE   NOT NULL DEFAULT 0,
      withdrawal DOUBLE   NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (login, d)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // พอร์ต Master — latest per-master performance, pushed daily from the VPS
  // (which reads the StrikePro widget API). The % figures (p_*) are the
  // platform's own deposit/withdrawal-neutral returns (Myfxbook-style TWR),
  // and `minichart` is the JSON etwr growth curve.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS pf_masters (
      account_id    VARCHAR(50)  NOT NULL PRIMARY KEY,
      name          VARCHAR(255) NOT NULL DEFAULT '',
      currency      VARCHAR(10)  NOT NULL DEFAULT 'USD',
      aum           DOUBLE       NOT NULL DEFAULT 0,
      balance       DOUBLE       NOT NULL DEFAULT 0,
      equity        DOUBLE       NOT NULL DEFAULT 0,
      followers     INT          NOT NULL DEFAULT 0,
      score         DOUBLE       NOT NULL DEFAULT 0,
      risk          DOUBLE       NOT NULL DEFAULT 0,
      max_dd        DOUBLE       NOT NULL DEFAULT 0,
      profit_factor DOUBLE       NOT NULL DEFAULT 0,
      p_week        DOUBLE       NOT NULL DEFAULT 0,
      p_month       DOUBLE       NOT NULL DEFAULT 0,
      p_3m          DOUBLE       NOT NULL DEFAULT 0,
      p_6m          DOUBLE       NOT NULL DEFAULT 0,
      p_12m         DOUBLE       NOT NULL DEFAULT 0,
      p_18m         DOUBLE       NOT NULL DEFAULT 0,
      p_all         DOUBLE       NOT NULL DEFAULT 0,
      minichart     LONGTEXT     NULL,
      sort_order    SMALLINT     NOT NULL DEFAULT 0,
      active        TINYINT(1)   NOT NULL DEFAULT 1,
      updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ── Customer onboarding (CS pipeline) ────────────────────────────────────────
  // Admin adds a customer's email; CS tracks a configurable checklist of steps
  // (KYC levels, deposit, …) marked done automatically via /api/onboarding/sync
  // (or manually by admin). Contact info is pulled live from the HQ profile and
  // can be topped up per customer.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS onboarding_steps (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      step_key   VARCHAR(60)  NOT NULL UNIQUE,     -- stable slug used by the API sync
      label      VARCHAR(200) NOT NULL,
      sort_order SMALLINT     NOT NULL DEFAULT 0,
      active     TINYINT(1)   NOT NULL DEFAULT 1,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS onboarding_customers (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      email      VARCHAR(255) NOT NULL UNIQUE,
      name       VARCHAR(255) NOT NULL DEFAULT '',
      contact    VARCHAR(500) NOT NULL DEFAULT '',   -- admin-entered social / contact channel
      note       TEXT         NULL,
      added_by   VARCHAR(255) NOT NULL DEFAULT '',
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS onboarding_progress (
      customer_id INT UNSIGNED NOT NULL,
      step_id     INT UNSIGNED NOT NULL,
      done        TINYINT(1)   NOT NULL DEFAULT 0,
      done_at     DATETIME     NULL,
      PRIMARY KEY (customer_id, step_id),
      KEY idx_customer (customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // Seed the default steps once (idempotent via unique step_key).
  await pool.execute(
    `INSERT IGNORE INTO onboarding_steps (step_key, label, sort_order) VALUES
       ('kyc_l1',    'KYC StrikePro Lv.1', 1),
       ('topup_l1',  'Top-Up KYC Lv.1',    2),
       ('topup_l2',  'Top-Up KYC Lv.2',    3),
       ('deposit',   'ฝากเงิน',            4)`
  );

  // The Last Day — per-edition admin state (registration closed / event completed).
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS the_last_day_state (
      edition             SMALLINT     NOT NULL PRIMARY KEY,
      registration_closed TINYINT(1)   NOT NULL DEFAULT 0,
      event_completed     TINYINT(1)   NOT NULL DEFAULT 0,
      updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // The Last Day — event registrations (one row per member per edition).
  // confirmed = "checked in / attended" (admin marks it at the event; unchecked
  // rows are removed when the event is completed).
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS the_last_day_registrations (
      id          INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
      edition     SMALLINT      NOT NULL DEFAULT 2,
      user_id     INT UNSIGNED  NULL,
      first_name  VARCHAR(120)  NOT NULL DEFAULT '',
      last_name   VARCHAR(120)  NOT NULL DEFAULT '',
      nickname    VARCHAR(120)  NOT NULL DEFAULT '',
      phone       VARCHAR(50)   NOT NULL DEFAULT '',
      email       VARCHAR(255)  NOT NULL DEFAULT '',
      line_id     VARCHAR(120)  NOT NULL DEFAULT '',
      seat_type   VARCHAR(10)   NOT NULL DEFAULT 'main',
      confirmed   TINYINT(1)    NOT NULL DEFAULT 0,
      confirmed_at DATETIME     NULL,
      created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_edition_email (edition, email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Allowlist of StrikePro customer emails (SHA-256 hash of the normalised email).
  // Synced daily from the StrikePro customer DB — registration is gated on this.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS eligible_emails (
      email_hash CHAR(64) NOT NULL PRIMARY KEY,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // One-time email verification codes for registration (expires_at is epoch ms).
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS email_otps (
      email      VARCHAR(255) NOT NULL PRIMARY KEY,
      code_hash  VARCHAR(255) NOT NULL,
      purpose    VARCHAR(20)  NOT NULL DEFAULT 'register',
      attempts   TINYINT      NOT NULL DEFAULT 0,
      expires_at BIGINT       NOT NULL,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Per-round MT5 aggregates for the Project dashboard, pushed from the VPS forex job.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS la_project_stats (
      round           INT           NOT NULL PRIMARY KEY,
      vip_has         INT           NOT NULL DEFAULT 0,
      vip_passed      INT           NOT NULL DEFAULT 0,
      port_checked    INT           NOT NULL DEFAULT 0,
      project_revenue DECIMAL(20,2) NOT NULL DEFAULT 0,
      total_equity    DECIMAL(20,2) NOT NULL DEFAULT 0,
      updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Per-student MT5 details (pushed from the VPS) — powers the click-to-details view.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS la_student_stats (
      email        VARCHAR(255)  NOT NULL,
      round        INT           NOT NULL,
      has_vip      TINYINT(1)    NOT NULL DEFAULT 0,
      vip_passed   TINYINT(1)    NOT NULL DEFAULT 0,
      vip_amount   DECIMAL(20,2) NOT NULL DEFAULT 0,
      vip_live     DECIMAL(20,2) NOT NULL DEFAULT 0,
      total_equity DECIMAL(20,2) NOT NULL DEFAULT 0,
      updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (email, round)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Last Account registration rounds — DB-driven so admins add/close rounds
  // without a code deploy (replaces the old hardcoded ROUNDS object).
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS last_account_rounds (
      round         INT          NOT NULL PRIMARY KEY,
      label         VARCHAR(100) NOT NULL,
      opens_at      DATETIME     NOT NULL,
      closes_at     DATETIME     NULL,
      event_date    DATE         NULL,
      event_end     DATE         NULL,
      main_seats    INT          NOT NULL DEFAULT 25,
      reserve_seats INT          NOT NULL DEFAULT 5,
      offset_count  INT          NOT NULL DEFAULT 0,
      closed        TINYINT(1)   NOT NULL DEFAULT 0,
      event_id      INT          NULL,
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // Seed once from the previously hardcoded rounds (Bangkok wall-clock times).
  {
    const [c] = await pool.execute('SELECT COUNT(*) AS n FROM last_account_rounds');
    if (Number(c[0].n) === 0) {
      await pool.query(
        `INSERT INTO last_account_rounds (round, label, opens_at, main_seats, reserve_seats, offset_count, closed) VALUES ?`,
        [[
          [2, 'รุ่นที่ 2', '2026-07-22 12:00:00', 25, 5, 0, 1],
          [3, 'รุ่นที่ 3', '2026-07-29 12:00:00', 25, 5, 0, 1],
          [4, 'รุ่นที่ 4', '2026-08-05 12:00:00', 25, 5, 15, 1],
          [5, 'รุ่นที่ 5', '2026-08-12 12:00:00', 25, 5, 0, 0],
        ]]
      );
    }
  }

  // Add multi-day event end (idempotent) for tables created before it existed.
  try { await pool.execute('ALTER TABLE last_account_rounds ADD COLUMN event_end DATE NULL AFTER event_date'); }
  catch (err) { if (err.errno !== 1060) throw err; }

  // Discord verifications — a Discord user proven to own a StrikePro-customer email.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS discord_verifications (
      discord_id       VARCHAR(32)  NOT NULL PRIMARY KEY,
      email            VARCHAR(255) NOT NULL,
      discord_username VARCHAR(255) NOT NULL DEFAULT '',
      guild_id         VARCHAR(32)  NOT NULL DEFAULT '',
      verified_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Add role column to users if it doesn't exist yet (idempotent migration)
  try {
    await pool.execute(`ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'`);
  } catch (err) {
    if (err.errno !== 1060) throw err; // 1060 = duplicate column — already exists, ignore
  }

  // Add round column to last_account_applications (idempotent). Legacy rows → round 1.
  try {
    await pool.execute(`ALTER TABLE last_account_applications ADD COLUMN round SMALLINT NOT NULL DEFAULT 1`);
  } catch (err) {
    if (err.errno !== 1060) throw err;
  }

  // Add birth date / age + admin-check flags (idempotent)
  for (const ddl of [
    `ALTER TABLE last_account_applications ADD COLUMN birth_date DATE NULL`,
    `ALTER TABLE last_account_applications ADD COLUMN age SMALLINT NULL`,
    `ALTER TABLE last_account_applications ADD COLUMN confirmed TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE last_account_applications ADD COLUMN confirmed_at DATETIME NULL`,
    `ALTER TABLE last_account_applications ADD COLUMN intro_submitted TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE last_account_applications ADD COLUMN intro_at DATETIME NULL`,
  ]) {
    try {
      await pool.execute(ddl);
    } catch (err) {
      if (err.errno !== 1060) throw err;
    }
  }

  // Add "has VIP port" counters (idempotent). พอร์ต VIP = owns an MT5 VIP account
  // (existence), distinct from vip_passed (sticky: ever reached $1000, drives revenue).
  for (const ddl of [
    `ALTER TABLE la_project_stats ADD COLUMN vip_has INT NOT NULL DEFAULT 0`,
    `ALTER TABLE la_student_stats  ADD COLUMN has_vip TINYINT(1) NOT NULL DEFAULT 0`,
  ]) {
    try {
      await pool.execute(ddl);
    } catch (err) {
      if (err.errno !== 1060) throw err;
    }
  }

  // Add profile columns to users (idempotent)
  for (const ddl of [
    `ALTER TABLE users ADD COLUMN full_name   VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN phone       VARCHAR(50)  NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN first_name  VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN last_name   VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN nickname    VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN birth_date  DATE NULL`,
    `ALTER TABLE users ADD COLUMN line_id     VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN addr_line   VARCHAR(500) NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN subdistrict VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN district    VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN province    VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN postal_code VARCHAR(20)  NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN avatar_data MEDIUMTEXT NULL`,
    // verified = email matched the StrikePro customer allowlist (advisory only; not a gate)
    `ALTER TABLE users ADD COLUMN verified TINYINT(1) NOT NULL DEFAULT 0`,
    // พอร์ต Master — AES-GCM-encrypted MT5 investor password (read-only creds the
    // VPS fetcher loop-logs with). Never returned to the browser.
    `ALTER TABLE pf_accounts ADD COLUMN inv_pw LONGTEXT NULL`,
  ]) {
    try { await pool.execute(ddl); } catch (err) { if (err.errno !== 1060) throw err; }
  }

  // Promote any emails listed in ADMIN_EMAILS (comma-separated) to admin on startup,
  // plus the protected super-admin owner(s) — always admin, regardless of ADMIN_EMAILS.
  // Idempotent; only affects users that already exist.
  const { list: superList } = require('../lib/super-admin');
  const adminEmails = [...new Set([
    ...(process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
    ...superList(),
  ])];
  if (adminEmails.length) {
    const placeholders = adminEmails.map(() => '?').join(', ');
    const [res] = await pool.execute(
      `UPDATE users SET role = 'admin' WHERE LOWER(email) IN (${placeholders}) AND role <> 'admin'`,
      adminEmails
    );
    if (res.affectedRows) console.log(`  Promoted ${res.affectedRows} user(s) to admin from ADMIN_EMAILS.`);
  }

  // Back-fill the advisory StrikePro-customer flag against the synced allowlist,
  // so members left verified=0 (flaky check at signup / predating the allowlist)
  // self-heal on deploy. Cheap single query; no-op when nothing matches.
  try {
    const n = await refreshVerifiedFromEligible();
    if (n) console.log(`  Back-filled verified=1 for ${n} member(s) from the allowlist.`);
  } catch (err) { console.error('verified back-fill failed:', err.message); }

  // Purge expired sessions on startup
  await pool.execute('DELETE FROM sessions WHERE expires_at <= NOW()');

  // Seed calendar events once (only if the table is empty)
  await seedEventsIfEmpty();

  // Ensure specific events that were added AFTER the initial seed exist even on
  // an already-populated DB (idempotent — matched by title + start_date).
  await ensureEvent({ title: 'The Last Day ครั้งที่ 2', start: '2026-08-23', end: '2026-08-23', color: '#818cf8', href: '/events/the-last-day', live: false });

  // Link the existing "กินข้าวบ้านจารย์" calendar entry to its new info page.
  await pool.execute(
    `UPDATE events SET href = '/events/dinner' WHERE title = 'กินข้าวบ้านจารย์' AND (href IS NULL OR href = '')`
  );

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

async function createUserFull(email, hashedPassword, fullName, phone) {
  const e = email.toLowerCase().trim();
  const [result] = await pool.execute(
    'INSERT INTO users (email, password, full_name, phone) VALUES (?, ?, ?, ?)',
    [e, hashedPassword, (fullName || '').trim(), (phone || '').trim()]
  );
  return { id: result.insertId, email: e };
}

async function createMember(d) {
  const e = (d.email || '').toLowerCase().trim();
  const s = v => String(v || '').trim();
  const full = `${s(d.firstName)} ${s(d.lastName)}`.trim();
  const [result] = await pool.execute(
    `INSERT INTO users
       (email, password, full_name, first_name, last_name, nickname, phone, birth_date,
        line_id, addr_line, subdistrict, district, province, postal_code, avatar_data, verified)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [e, d.hashedPassword, full, s(d.firstName), s(d.lastName), s(d.nickname), s(d.phone),
     d.birthDate || null, s(d.lineId), s(d.addrLine), s(d.subdistrict), s(d.district),
     s(d.province), s(d.postalCode), d.avatarData || null, d.verified ? 1 : 0]
  );
  return { id: result.insertId, email: e };
}

// Update a member's editable profile fields (not email / password / role).
// avatar_data is only overwritten when a new value is supplied (null = keep).
async function updateUserProfile(id, d) {
  const s = v => String(v || '').trim();
  const full = `${s(d.firstName)} ${s(d.lastName)}`.trim();
  const sets = [
    'full_name=?', 'first_name=?', 'last_name=?', 'nickname=?', 'phone=?', 'birth_date=?',
    'line_id=?', 'addr_line=?', 'subdistrict=?', 'district=?', 'province=?', 'postal_code=?',
  ];
  const vals = [
    full, s(d.firstName), s(d.lastName), s(d.nickname), s(d.phone), d.birthDate || null,
    s(d.lineId), s(d.addrLine), s(d.subdistrict), s(d.district), s(d.province), s(d.postalCode),
  ];
  if (d.avatarData) { sets.push('avatar_data=?'); vals.push(d.avatarData); }
  vals.push(id);
  const [res] = await pool.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
  return res.affectedRows > 0;
}

// ── Eligibility (StrikePro customer allowlist) ─────────────────────────────────

async function isEmailEligible(emailHash) {
  const [rows] = await pool.execute('SELECT 1 FROM eligible_emails WHERE email_hash = ? LIMIT 1', [emailHash]);
  return rows.length > 0;
}

async function countEligible() {
  const [rows] = await pool.execute('SELECT COUNT(*) AS n FROM eligible_emails');
  return rows[0].n;
}

async function addEligibleHashes(hashes) {
  let added = 0;
  const CH = 1000;
  for (let i = 0; i < hashes.length; i += CH) {
    const chunk = hashes.slice(i, i + CH);
    const ph = chunk.map(() => '(?)').join(',');
    const [r] = await pool.query(`INSERT IGNORE INTO eligible_emails (email_hash) VALUES ${ph}`, chunk);
    added += r.affectedRows;
  }
  return added;
}

// Flip verified=1 for members whose email now matches the customer allowlist.
// Called after a sync so newly-added customers auto-upgrade without manual work.
// Returns the number of members newly marked verified.
async function refreshVerifiedFromEligible() {
  const [r] = await pool.execute(
    `UPDATE users
     SET verified = 1
     WHERE verified = 0
       AND SHA2(LOWER(TRIM(email)), 256) IN (SELECT email_hash FROM eligible_emails)`
  );
  return r.affectedRows;
}

// ── Email OTPs ─────────────────────────────────────────────────────────────────

async function upsertOtp(email, codeHash, expiresAtMs, purpose = 'register') {
  await pool.execute(
    `INSERT INTO email_otps (email, code_hash, purpose, attempts, expires_at)
     VALUES (?, ?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash), purpose=VALUES(purpose),
       attempts=0, expires_at=VALUES(expires_at), created_at=CURRENT_TIMESTAMP`,
    [email.toLowerCase().trim(), codeHash, purpose, expiresAtMs]
  );
}

async function getOtp(email) {
  const [rows] = await pool.execute('SELECT * FROM email_otps WHERE email = ? LIMIT 1', [email.toLowerCase().trim()]);
  return rows[0] || null;
}

async function incOtpAttempts(email) {
  await pool.execute('UPDATE email_otps SET attempts = attempts + 1 WHERE email = ?', [email.toLowerCase().trim()]);
}

async function deleteOtp(email) {
  await pool.execute('DELETE FROM email_otps WHERE email = ?', [email.toLowerCase().trim()]);
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

// ── Last Account (บ้านหลังสุดท้าย) applications ─────────────────────────────────

async function countLastAccountApplications(round) {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS c FROM last_account_applications WHERE round = ?',
    [round]
  );
  return Number(rows[0].c);
}

/**
 * Insert an application atomically with a per-round capacity check.
 * Returns { full: true } if the round's main+reserve seats are exhausted,
 * otherwise { id, seat_type, position }.
 */
async function hasLastAccountApplication(email, round) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM last_account_applications WHERE email = ? AND round = ? LIMIT 1',
    [String(email || '').toLowerCase().trim(), round]
  );
  return rows.length > 0;
}

async function createLastAccountApplication(data, round, mainSeats, reserveSeats, offset = 0) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      'SELECT COUNT(*) AS c FROM last_account_applications WHERE round = ? FOR UPDATE',
      [round]
    );
    const count = Number(rows[0].c) + offset; // include backend-registered applicants
    if (count >= mainSeats + reserveSeats) {
      await conn.rollback();
      return { full: true };
    }
    const seatType = count < mainSeats ? 'main' : 'reserve';
    const [result] = await conn.execute(
      `INSERT INTO last_account_applications
         (first_name, last_name, nickname, birth_date, age, phone, email, mt5_account, line_id, discord_id, seat_type, round)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.first_name, data.last_name, data.nickname, data.birth_date, data.age,
       data.phone, data.email, data.mt5_account, data.line_id, data.discord_id, seatType, round]
    );
    await conn.commit();
    return { id: result.insertId, seat_type: seatType, position: count + 1 };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listLastAccountApplications() {
  const [rows] = await pool.execute(
    `SELECT la.id, la.first_name, la.last_name, la.nickname, la.birth_date, la.age, la.phone, la.email, la.mt5_account,
            la.line_id, la.discord_id, la.seat_type, la.round, la.confirmed, la.intro_submitted, la.created_at,
            COALESCE(u.verified, 0) AS verified
     FROM last_account_applications la
     LEFT JOIN users u ON LOWER(TRIM(u.email)) = LOWER(TRIM(la.email))
     ORDER BY la.round ASC, la.created_at ASC`
  );
  return rows;
}

// Toggle an admin check flag (confirmed | intro_submitted) + stamp its *_at time.
async function setLastAccountFlag(id, field, value) {
  const at = { confirmed: 'confirmed_at', intro_submitted: 'intro_at' }[field];
  if (!at) throw new Error('invalid field');
  const v = value ? 1 : 0;
  await pool.execute(
    `UPDATE last_account_applications SET ${field} = ?, ${at} = ${v ? 'NOW()' : 'NULL'} WHERE id = ?`,
    [v, id]
  );
}

// Confirmed students (round + email) for the VPS forex job to match against MT5.
async function getConfirmedStudents() {
  const [rows] = await pool.execute(
    `SELECT round, LOWER(TRIM(email)) AS email
     FROM last_account_applications WHERE confirmed = 1 AND TRIM(email) <> ''`
  );
  return rows.map(r => ({ round: r.round == null ? 0 : r.round, email: r.email }));
}

// Upsert per-round MT5 aggregates pushed from the VPS.
async function upsertProjectStats(round, s) {
  await pool.execute(
    `INSERT INTO la_project_stats (round, vip_has, vip_passed, port_checked, project_revenue, total_equity)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE vip_has=VALUES(vip_has), vip_passed=VALUES(vip_passed), port_checked=VALUES(port_checked),
       project_revenue=VALUES(project_revenue), total_equity=VALUES(total_equity)`,
    [round, parseInt(s.vip_has, 10) || 0, parseInt(s.vip_passed, 10) || 0, parseInt(s.port_checked, 10) || 0,
     Number(s.project_revenue) || 0, Number(s.total_equity) || 0]
  );
}

async function getProjectStats() {
  const [rows] = await pool.execute('SELECT * FROM la_project_stats');
  const m = {};
  rows.forEach(r => { m[r.round] = r; });
  return m;
}

// Replace a round's per-student MT5 rows (delete + bulk insert).
async function replaceStudentStats(round, students) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM la_student_stats WHERE round = ?', [round]);
    for (const s of students) {
      const email = String(s.email || '').toLowerCase().trim();
      if (!email) continue;
      await conn.execute(
        `INSERT INTO la_student_stats (email, round, has_vip, vip_passed, vip_amount, vip_live, total_equity)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE has_vip=VALUES(has_vip), vip_passed=VALUES(vip_passed), vip_amount=VALUES(vip_amount),
                                 vip_live=VALUES(vip_live), total_equity=VALUES(total_equity)`,
        [email, round, s.has_vip ? 1 : 0, s.vip_passed ? 1 : 0, Number(s.vip_amount) || 0, Number(s.vip_live) || 0, Number(s.total_equity) || 0]
      );
    }
    await conn.commit();
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}

// Students of a round with funnel flags (live) + MT5 details (from la_student_stats).
async function getRoundStudents(round) {
  const [rows] = await pool.execute(
    `SELECT la.nickname, la.first_name, la.last_name, la.email,
            la.confirmed, la.intro_submitted, la.seat_type,
            COALESCE(s.has_vip,0)      AS has_vip,
            COALESCE(s.vip_passed,0)   AS vip_passed,
            COALESCE(s.vip_amount,0)   AS vip_amount,
            COALESCE(s.vip_live,0)     AS vip_live,
            COALESCE(s.total_equity,0) AS total_equity,
            (s.email IS NOT NULL)      AS has_forex
     FROM last_account_applications la
     LEFT JOIN la_student_stats s ON s.email = LOWER(TRIM(la.email)) AND s.round = la.round
     WHERE la.round = ?
     ORDER BY la.confirmed DESC, s.total_equity DESC, la.created_at ASC`,
    [round]
  );
  return rows;
}

// Per-round funnel counts for the Project dashboard.
async function lastAccountDashboard() {
  const [rows] = await pool.execute(
    `SELECT round,
            COUNT(*)                    AS registrants,
            SUM(confirmed = 1)          AS confirmed,
            SUM(intro_submitted = 1)    AS intro
     FROM last_account_applications
     GROUP BY round ORDER BY round ASC`
  );
  return rows.map(r => ({
    round: r.round == null ? 0 : r.round,
    registrants: Number(r.registrants),
    confirmed:   Number(r.confirmed),
    intro:       Number(r.intro),
  }));
}

// ── User management (admin) ───────────────────────────────────────────────────

async function searchUsers(q) {
  if (q) {
    const [rows] = await pool.execute(
      'SELECT id, email, role, verified, created_at FROM users WHERE email LIKE ? ORDER BY created_at DESC LIMIT 300',
      ['%' + q + '%']
    );
    return rows;
  }
  const [rows] = await pool.execute(
    'SELECT id, email, role, verified, created_at FROM users ORDER BY created_at DESC LIMIT 300'
  );
  return rows;
}

async function deleteUserById(id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM sessions WHERE user_id = ?', [id]);
    const [result] = await conn.execute('DELETE FROM users WHERE id = ?', [id]);
    await conn.commit();
    return result.affectedRows > 0;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function setUserRole(id, role) {
  const [res] = await pool.execute('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  return res.affectedRows > 0;
}

// Manually set the advisory StrikePro-customer flag (admin action).
async function setUserVerified(id, verified) {
  const [res] = await pool.execute('UPDATE users SET verified = ? WHERE id = ?', [verified ? 1 : 0, id]);
  return res.affectedRows > 0;
}
// All members not yet marked verified — for the admin "re-verify" backfill.
async function listUnverifiedUsers() {
  const [rows] = await pool.execute('SELECT id, email FROM users WHERE verified = 0');
  return rows;
}

// Set a new password and invalidate the user's sessions (force re-login)
async function setUserPassword(id, hashedPassword) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, id]);
    await conn.execute('DELETE FROM sessions WHERE user_id = ?', [id]);
    await conn.commit();
    return res.affectedRows > 0;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── The Last Day — event registrations ─────────────────────────────────────────

async function countTheLastDayRegistrations(edition) {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS c FROM the_last_day_registrations WHERE edition = ?',
    [edition]
  );
  return Number(rows[0].c);
}

async function hasTheLastDayRegistration(email, edition) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM the_last_day_registrations WHERE email = ? AND edition = ? LIMIT 1',
    [String(email || '').toLowerCase().trim(), edition]
  );
  return rows.length > 0;
}

/**
 * Insert a registration atomically with a per-edition capacity check.
 * Returns { full: true } if main+reserve seats are exhausted, else { id, seat_type, position }.
 * Throws ER_DUP_ENTRY (1062) if the member already registered this edition.
 */
async function createTheLastDayRegistration(data, edition, mainSeats, reserveSeats) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      'SELECT COUNT(*) AS c FROM the_last_day_registrations WHERE edition = ? FOR UPDATE',
      [edition]
    );
    const count = Number(rows[0].c);
    if (count >= mainSeats + reserveSeats) {
      await conn.rollback();
      return { full: true };
    }
    const seatType = count < mainSeats ? 'main' : 'reserve';
    const [result] = await conn.execute(
      `INSERT INTO the_last_day_registrations
         (edition, user_id, first_name, last_name, nickname, phone, email, line_id, seat_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [edition, data.user_id || null, data.first_name, data.last_name, data.nickname,
       data.phone, data.email, data.line_id, seatType]
    );
    await conn.commit();
    return { id: result.insertId, seat_type: seatType, position: count + 1 };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listTheLastDayRegistrations(edition = null) {
  const where = edition == null ? '' : 'WHERE r.edition = ?';
  const args  = edition == null ? [] : [edition];
  const [rows] = await pool.execute(
    `SELECT r.id, r.edition, r.first_name, r.last_name, r.nickname, r.phone, r.email, r.line_id,
            r.seat_type, r.confirmed, r.confirmed_at, r.created_at,
            COALESCE(u.verified, 0) AS verified
     FROM the_last_day_registrations r
     LEFT JOIN users u ON LOWER(TRIM(u.email)) = LOWER(TRIM(r.email))
     ${where}
     ORDER BY r.edition ASC, r.created_at ASC`,
    args
  );
  return rows;
}

// Toggle the admin check-in flag (confirmed = "attended") + stamp its time.
async function setTheLastDayFlag(id, value) {
  const v = value ? 1 : 0;
  await pool.execute(
    `UPDATE the_last_day_registrations SET confirmed = ?, confirmed_at = ${v ? 'NOW()' : 'NULL'} WHERE id = ?`,
    [v, id]
  );
}

// ── กินข้าวบ้านจารย์ (dinner) rounds ───────────────────────────────────────────
async function getActiveDinnerEdition() {
  const [rows] = await pool.execute('SELECT * FROM dinner_editions ORDER BY round DESC LIMIT 1');
  return rows[0] || null;
}
async function getDinnerEditionRow(round) {
  const [rows] = await pool.execute('SELECT * FROM dinner_editions WHERE round = ? LIMIT 1', [round]);
  return rows[0] || null;
}
// First round created = 3 (COALESCE(MAX,2)+1); then 4, 5, …
async function createNextDinnerEdition(d) {
  const [m] = await pool.execute('SELECT COALESCE(MAX(round), 2) AS mx FROM dinner_editions');
  const next = Number(m[0].mx) + 1;
  await pool.execute(
    'INSERT INTO dinner_editions (round, opens_at, event_start, event_end, venue) VALUES (?, ?, ?, ?, ?)',
    [next, d.opens_at, d.event_start, d.event_end, String(d.venue || '').slice(0, 255)]
  );
  return getDinnerEditionRow(next);
}
async function updateDinnerEdition(round, d) {
  await pool.execute(
    'UPDATE dinner_editions SET event_start = ?, event_end = ?, venue = ? WHERE round = ?',
    [d.event_start, d.event_end, String(d.venue || '').slice(0, 255), round]
  );
  return getDinnerEditionRow(round);
}
// ── กินข้าวบ้านจารย์ RSVP registrations ────────────────────────────────────────
async function countDinnerRegistrations(round) {
  const [r] = await pool.execute('SELECT COUNT(*) AS c FROM dinner_registrations WHERE round = ?', [round]);
  return Number(r[0].c);
}
async function hasDinnerRegistration(email, round) {
  const [r] = await pool.execute(
    'SELECT 1 FROM dinner_registrations WHERE email = ? AND round = ? LIMIT 1',
    [String(email || '').toLowerCase().trim(), round]);
  return r.length > 0;
}
async function createDinnerRegistration(data, round) {
  const [r] = await pool.execute(
    `INSERT INTO dinner_registrations (round, user_id, first_name, last_name, nickname, phone, email, line_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [round, data.user_id || null, data.first_name, data.last_name, data.nickname, data.phone, data.email, data.line_id]);
  return { id: r.insertId };
}
async function listDinnerRegistrations(round) {
  const where = round == null ? '' : 'WHERE r.round = ?';
  const args  = round == null ? [] : [round];
  const [rows] = await pool.execute(
    `SELECT r.id, r.round, r.first_name, r.last_name, r.nickname, r.phone, r.email, r.line_id,
            r.confirmed, r.confirmed_at, r.created_at, COALESCE(u.verified, 0) AS verified
     FROM dinner_registrations r
     LEFT JOIN users u ON LOWER(TRIM(u.email)) = LOWER(TRIM(r.email))
     ${where} ORDER BY r.created_at ASC`, args);
  return rows;
}
async function setDinnerFlag(id, value) {
  const v = value ? 1 : 0;
  await pool.execute(
    `UPDATE dinner_registrations SET confirmed = ?, confirmed_at = ${v ? 'NOW()' : 'NULL'} WHERE id = ?`, [v, id]);
}
async function getDinnerEmailById(id) {
  const [rows] = await pool.execute('SELECT email FROM dinner_registrations WHERE id = ? LIMIT 1', [id]);
  return rows[0] ? rows[0].email : null;
}
async function emailInDinner(email) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM dinner_registrations WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND confirmed = 1 LIMIT 1',
    [String(email || '')]);
  return rows.length > 0;
}

// One shared calendar entry "กินข้าวบ้านจารย์" (no round number) that moves to the
// current round's date on home + dashboard.
async function upsertDinnerCalendarEvent(dateYMD) {
  const title = 'กินข้าวบ้านจารย์', href = '/events/dinner', color = '#4ade80';
  const [rows] = await pool.execute('SELECT id FROM events WHERE title = ? LIMIT 1', [title]);
  if (rows.length) {
    await pool.execute('UPDATE events SET start_date = ?, end_date = ?, color = ?, href = ? WHERE id = ?',
      [dateYMD, dateYMD, color, href, rows[0].id]);
    return rows[0].id;
  }
  const [r] = await pool.execute(
    'INSERT INTO events (title, start_date, end_date, color, href, live) VALUES (?, ?, ?, ?, ?, 0)',
    [title, dateYMD, dateYMD, color, href]);
  return r.insertId;
}

// The active edition = the highest edition number (the newest one opened).
async function getActiveTheLastDayEdition() {
  const [rows] = await pool.execute(
    'SELECT * FROM the_last_day_editions ORDER BY edition DESC LIMIT 1'
  );
  return rows[0] || null;
}

async function getTheLastDayEditionRow(edition) {
  const [rows] = await pool.execute('SELECT * FROM the_last_day_editions WHERE edition = ? LIMIT 1', [edition]);
  return rows[0] || null;
}

// Edit an existing edition's date/time/venue/seats.
async function updateTheLastDayEdition(edition, d) {
  await pool.execute(
    `UPDATE the_last_day_editions
       SET event_start = ?, event_end = ?, venue = ?, main_seats = ?, reserve_seats = ?
     WHERE edition = ?`,
    [d.event_start, d.event_end, String(d.venue || '').slice(0, 255), d.main_seats || 30, d.reserve_seats || 10, edition]
  );
  return getTheLastDayEditionRow(edition);
}

// Mirror an edition onto the shared `events` calendar (home + dashboard).
// Idempotent by title ("The Last Day ครั้งที่ N") so editing updates the same row.
async function upsertTheLastDayCalendarEvent(edition, dateYMD) {
  const title = 'The Last Day ครั้งที่ ' + edition;
  const href  = '/events/the-last-day';
  const color = '#818cf8';
  const [rows] = await pool.execute('SELECT id FROM events WHERE title = ? LIMIT 1', [title]);
  if (rows.length) {
    await pool.execute('UPDATE events SET start_date = ?, end_date = ?, color = ?, href = ? WHERE id = ?',
      [dateYMD, dateYMD, color, href, rows[0].id]);
    return rows[0].id;
  }
  const [r] = await pool.execute(
    'INSERT INTO events (title, start_date, end_date, color, href, live) VALUES (?, ?, ?, ?, ?, 0)',
    [title, dateYMD, dateYMD, color, href]);
  return r.insertId;
}

// Create the next edition (max+1) and return its row. Registration opens immediately.
async function createNextTheLastDayEdition(d) {
  const [m] = await pool.execute('SELECT COALESCE(MAX(edition), 1) AS mx FROM the_last_day_editions');
  const next = Number(m[0].mx) + 1;
  await pool.execute(
    `INSERT INTO the_last_day_editions
       (edition, label, opens_at, event_start, event_end, venue, main_seats, reserve_seats)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [next, 'ครั้งที่ ' + next, d.opens_at, d.event_start, d.event_end,
     String(d.venue || '').slice(0, 255), d.main_seats || 30, d.reserve_seats || 10]
  );
  return getTheLastDayEditionRow(next);
}

// Per-edition admin state (registration_closed / event_completed). Defaults to 0/0.
async function getTheLastDayState(edition) {
  const [rows] = await pool.execute(
    'SELECT registration_closed, event_completed FROM the_last_day_state WHERE edition = ? LIMIT 1',
    [edition]
  );
  const r = rows[0] || {};
  return {
    registration_closed: !!Number(r.registration_closed),
    event_completed:     !!Number(r.event_completed),
  };
}

async function setTheLastDayState(edition, { registration_closed, event_completed }) {
  const cur = await getTheLastDayState(edition);
  const rc = registration_closed === undefined ? (cur.registration_closed ? 1 : 0) : (registration_closed ? 1 : 0);
  const ec = event_completed     === undefined ? (cur.event_completed ? 1 : 0)     : (event_completed ? 1 : 0);
  await pool.execute(
    `INSERT INTO the_last_day_state (edition, registration_closed, event_completed)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE registration_closed = VALUES(registration_closed), event_completed = VALUES(event_completed)`,
    [edition, rc, ec]
  );
  return { registration_closed: !!rc, event_completed: !!ec };
}

// Remove registrations that were never checked in (did not attend). Returns count.
async function deleteUncheckedTheLastDay(edition) {
  const [r] = await pool.execute(
    'DELETE FROM the_last_day_registrations WHERE edition = ? AND confirmed = 0',
    [edition]
  );
  return r.affectedRows;
}

// ── Fund portfolios (MT5) ───────────────────────────────────────────────────────
async function upsertPortfolioAccount(login, d) {
  await pool.execute(
    `INSERT INTO pf_accounts (login, label, server, currency)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       label    = COALESCE(NULLIF(VALUES(label), ''), label),
       server   = COALESCE(NULLIF(VALUES(server), ''), server),
       currency = COALESCE(NULLIF(VALUES(currency), ''), currency)`,
    [login, String(d.label || '').slice(0, 120), String(d.server || '').slice(0, 120), String(d.currency || 'USD').slice(0, 10)]
  );
}
async function upsertPortfolioDaily(login, s) {
  await pool.execute(
    `INSERT INTO pf_daily (login, d, balance, equity, deposit, withdrawal)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE balance=VALUES(balance), equity=VALUES(equity),
       deposit=VALUES(deposit), withdrawal=VALUES(withdrawal)`,
    [login, s.d, Number(s.balance) || 0, Number(s.equity) || 0, Number(s.deposit) || 0, Number(s.withdrawal) || 0]
  );
}
async function listPortfolioAccounts() {
  const [rows] = await pool.execute('SELECT login, label, currency, active FROM pf_accounts ORDER BY sort_order ASC, login ASC');
  return rows;
}

// พอร์ต Master account management (admin adds MT5 login + encrypted investor pw).
async function saveMasterAccount(login, d) {
  // d: { label, server, currency, sort_order, active, invPwEnc? }  (invPwEnc = ciphertext or undefined to keep)
  await pool.execute(
    `INSERT INTO pf_accounts (login, label, server, currency, sort_order, active, inv_pw)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       label      = VALUES(label),
       server     = VALUES(server),
       currency   = VALUES(currency),
       sort_order = VALUES(sort_order),
       active     = VALUES(active),
       inv_pw     = COALESCE(VALUES(inv_pw), inv_pw)`,
    [login, String(d.label || '').slice(0, 120), String(d.server || '').slice(0, 120),
     String(d.currency || 'USD').slice(0, 10), parseInt(d.sort_order, 10) || 0,
     d.active === 0 ? 0 : 1, d.invPwEnc == null ? null : String(d.invPwEnc)]
  );
}
// Admin list — masks the password, exposes only whether one is set.
async function listMasterAccountsAdmin() {
  const [rows] = await pool.execute(
    `SELECT login, label, server, currency, active, sort_order,
            (inv_pw IS NOT NULL AND inv_pw <> '') AS has_pw,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i') AS updated_at
     FROM pf_accounts ORDER BY sort_order ASC, login ASC`
  );
  return rows;
}
// Fetcher list — returns the encrypted password for the route to decrypt (sync key only).
async function listMasterAccountsForFetch() {
  const [rows] = await pool.execute(
    'SELECT login, server, currency, inv_pw FROM pf_accounts WHERE active = 1 ORDER BY sort_order ASC, login ASC'
  );
  return rows;
}
async function deleteMasterAccount(login) {
  await pool.execute('DELETE FROM pf_daily WHERE login = ?', [login]);
  await pool.execute('DELETE FROM pf_accounts WHERE login = ?', [login]);
}
async function setMasterActive(login, active) {
  await pool.execute('UPDATE pf_accounts SET active = ? WHERE login = ?', [active ? 1 : 0, login]);
}

// ── Customer onboarding (CS pipeline) ───────────────────────────────────────────
function slugifyStepKey(label) {
  const s = String(label || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
  return s || ('step_' + Date.now());
}
async function listOnboardingSteps(activeOnly = false) {
  const [rows] = await pool.execute(
    `SELECT id, step_key, label, sort_order, active FROM onboarding_steps
     ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}
async function addOnboardingStep(d) {
  const label = String(d.label || '').trim();
  if (!label) return null;
  let key = String(d.step_key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '') || slugifyStepKey(label);
  // ensure uniqueness
  const [ex] = await pool.execute('SELECT 1 FROM onboarding_steps WHERE step_key = ? LIMIT 1', [key]);
  if (ex.length) key = key + '_' + Date.now().toString(36);
  let sort = parseInt(d.sort_order, 10);
  if (!Number.isFinite(sort)) {
    const [m] = await pool.execute('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM onboarding_steps');
    sort = m[0].n;
  }
  const [r] = await pool.execute(
    'INSERT INTO onboarding_steps (step_key, label, sort_order) VALUES (?,?,?)',
    [key.slice(0, 60), label.slice(0, 200), sort]
  );
  return r.insertId;
}
async function updateOnboardingStep(id, d) {
  const sets = [], vals = [];
  if (d.label != null)      { sets.push('label = ?');      vals.push(String(d.label).slice(0, 200)); }
  if (d.sort_order != null) { sets.push('sort_order = ?'); vals.push(parseInt(d.sort_order, 10) || 0); }
  if (d.active != null)     { sets.push('active = ?');     vals.push(d.active ? 1 : 0); }
  if (!sets.length) return false;
  vals.push(id);
  const [r] = await pool.execute(`UPDATE onboarding_steps SET ${sets.join(', ')} WHERE id = ?`, vals);
  return r.affectedRows > 0;
}
async function deleteOnboardingStep(id) {
  await pool.execute('DELETE FROM onboarding_progress WHERE step_id = ?', [id]);
  const [r] = await pool.execute('DELETE FROM onboarding_steps WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

async function addOnboardingCustomer(d) {
  const email = String(d.email || '').trim().toLowerCase();
  if (!email) return null;
  await pool.execute(
    `INSERT INTO onboarding_customers (email, name, contact, note, added_by)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       name    = COALESCE(NULLIF(VALUES(name),''), name),
       contact = COALESCE(NULLIF(VALUES(contact),''), contact),
       note    = COALESCE(VALUES(note), note)`,
    [email, String(d.name || '').slice(0, 255), String(d.contact || '').slice(0, 500),
     d.note != null ? String(d.note) : null, String(d.added_by || '').slice(0, 255)]
  );
  const [row] = await pool.execute('SELECT id FROM onboarding_customers WHERE email = ?', [email]);
  return row.length ? row[0].id : null;
}
async function updateOnboardingCustomer(id, d) {
  const sets = [], vals = [];
  if (d.name != null)    { sets.push('name = ?');    vals.push(String(d.name).slice(0, 255)); }
  if (d.contact != null) { sets.push('contact = ?'); vals.push(String(d.contact).slice(0, 500)); }
  if (d.note != null)    { sets.push('note = ?');    vals.push(String(d.note)); }
  if (!sets.length) return false;
  vals.push(id);
  const [r] = await pool.execute(`UPDATE onboarding_customers SET ${sets.join(', ')} WHERE id = ?`, vals);
  return r.affectedRows > 0;
}
async function deleteOnboardingCustomer(id) {
  await pool.execute('DELETE FROM onboarding_progress WHERE customer_id = ?', [id]);
  const [r] = await pool.execute('DELETE FROM onboarding_customers WHERE id = ?', [id]);
  return r.affectedRows > 0;
}
// Customers + live registration status (HQ profile join + StrikePro allowlist) + progress map.
async function listOnboardingCustomers() {
  const [rows] = await pool.execute(
    `SELECT c.id, c.email, c.name, c.contact, c.note, c.added_by,
            DATE_FORMAT(c.created_at, '%Y-%m-%d %H:%i') AS created_at,
            (u.id IS NOT NULL)                                   AS hq_registered,
            u.phone AS hq_phone, u.line_id AS hq_line, u.nickname AS hq_nickname,
            TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))) AS hq_name,
            (SHA2(LOWER(TRIM(c.email)),256) IN (SELECT email_hash FROM eligible_emails)) AS strikepro_registered
     FROM onboarding_customers c
     LEFT JOIN users u ON LOWER(u.email) = LOWER(c.email)
     ORDER BY c.created_at DESC`
  );
  const [prog] = await pool.execute(
    `SELECT customer_id, step_id, done, DATE_FORMAT(done_at, '%Y-%m-%d %H:%i') AS done_at FROM onboarding_progress`
  );
  const byCust = new Map();
  for (const p of prog) {
    if (!byCust.has(p.customer_id)) byCust.set(p.customer_id, {});
    byCust.get(p.customer_id)[p.step_id] = { done: !!p.done, done_at: p.done_at };
  }
  rows.forEach(r => { r.progress = byCust.get(r.id) || {}; });
  return rows;
}
async function setOnboardingProgress(customerId, stepId, done) {
  await pool.execute(
    `INSERT INTO onboarding_progress (customer_id, step_id, done, done_at)
     VALUES (?,?,?,${done ? 'NOW()' : 'NULL'})
     ON DUPLICATE KEY UPDATE done = VALUES(done), done_at = ${done ? 'NOW()' : 'NULL'}`,
    [customerId, stepId, done ? 1 : 0]
  );
}
// Sync helper: mark a step done/undone by (email, step_key). Returns true if matched.
async function setOnboardingProgressByKey(email, stepKey, done) {
  const [c] = await pool.execute('SELECT id FROM onboarding_customers WHERE email = ?', [String(email || '').trim().toLowerCase()]);
  if (!c.length) return false;
  const [s] = await pool.execute('SELECT id FROM onboarding_steps WHERE step_key = ?', [String(stepKey || '').trim().toLowerCase()]);
  if (!s.length) return false;
  await setOnboardingProgress(c[0].id, s[0].id, done);
  return true;
}
async function getPortfolioDaily() {
  const [rows] = await pool.execute(
    `SELECT login, DATE_FORMAT(d, '%Y-%m-%d') AS d, balance, equity, deposit, withdrawal
     FROM pf_daily
     WHERE login IN (SELECT login FROM pf_accounts WHERE active = 1)
     ORDER BY login ASC, d ASC`
  );
  return rows;
}

// ── พอร์ต Master (StrikePro widget API, pushed from the VPS) ─────────────────────
async function upsertMaster(m) {
  const id = String(m.account_id || '').slice(0, 50);
  if (!id) return;
  const mc = m.minichart == null ? null
    : (typeof m.minichart === 'string' ? m.minichart : JSON.stringify(m.minichart));
  await pool.execute(
    `INSERT INTO pf_masters
       (account_id, name, currency, aum, balance, equity, followers, score, risk,
        max_dd, profit_factor, p_week, p_month, p_3m, p_6m, p_12m, p_18m, p_all,
        minichart, sort_order, active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
     ON DUPLICATE KEY UPDATE
       name=COALESCE(NULLIF(VALUES(name),''),name), currency=VALUES(currency),
       aum=VALUES(aum), balance=VALUES(balance), equity=VALUES(equity),
       followers=VALUES(followers), score=VALUES(score), risk=VALUES(risk),
       max_dd=VALUES(max_dd), profit_factor=VALUES(profit_factor),
       p_week=VALUES(p_week), p_month=VALUES(p_month), p_3m=VALUES(p_3m),
       p_6m=VALUES(p_6m), p_12m=VALUES(p_12m), p_18m=VALUES(p_18m), p_all=VALUES(p_all),
       minichart=VALUES(minichart), sort_order=VALUES(sort_order), active=1`,
    [id, String(m.name || '').slice(0, 255), String(m.currency || 'USD').slice(0, 10),
     Number(m.aum) || 0, Number(m.balance) || 0, Number(m.equity) || 0,
     parseInt(m.followers, 10) || 0, Number(m.score) || 0, Number(m.risk) || 0,
     Number(m.max_dd) || 0, Number(m.profit_factor) || 0,
     Number(m.p_week) || 0, Number(m.p_month) || 0, Number(m.p_3m) || 0,
     Number(m.p_6m) || 0, Number(m.p_12m) || 0, Number(m.p_18m) || 0, Number(m.p_all) || 0,
     mc, parseInt(m.sort_order, 10) || 0]
  );
}
async function listMasters() {
  const [rows] = await pool.execute(
    `SELECT account_id, name, currency, aum, balance, equity, followers, score, risk,
            max_dd, profit_factor, p_week, p_month, p_3m, p_6m, p_12m, p_18m, p_all,
            minichart, DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at
     FROM pf_masters WHERE active = 1
     ORDER BY sort_order ASC, aum DESC, account_id ASC`
  );
  return rows;
}

// ── Events (calendar) ─────────────────────────────────────────────────────────

// DB row -> API shape used by the calendar frontend: { id, t, s:[y,m,d], e:[y,m,d], c, h, live }
function eventRowToApi(row) {
  const toArr = s => s.split('-').map(Number);
  return {
    id:   Number(row.id),
    t:    row.title,
    s:    toArr(row.start_date),
    e:    toArr(row.end_date),
    c:    row.color,
    h:    row.href || null,
    live: !!row.live,
  };
}

const EVENT_COLS = `id, title,
  DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
  DATE_FORMAT(end_date,   '%Y-%m-%d') AS end_date,
  color, href, live`;

async function listEvents() {
  const [rows] = await pool.execute(
    `SELECT ${EVENT_COLS} FROM events ORDER BY start_date ASC, end_date ASC, id ASC`
  );
  return rows.map(eventRowToApi);
}

async function getEventById(id) {
  const [rows] = await pool.execute(`SELECT ${EVENT_COLS} FROM events WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ? eventRowToApi(rows[0]) : null;
}

async function createEvent({ title, start, end, color, href, live }) {
  const [result] = await pool.execute(
    `INSERT INTO events (title, start_date, end_date, color, href, live) VALUES (?, ?, ?, ?, ?, ?)`,
    [title, start, end, color || '#d4af37', href || null, live ? 1 : 0]
  );
  return getEventById(result.insertId);
}

async function updateEvent(id, { title, start, end, color, href, live }) {
  const [result] = await pool.execute(
    `UPDATE events SET title=?, start_date=?, end_date=?, color=?, href=?, live=? WHERE id=?`,
    [title, start, end, color || '#d4af37', href || null, live ? 1 : 0, id]
  );
  if (!result.affectedRows) return null;
  return getEventById(id);
}

async function deleteEvent(id) {
  const [result] = await pool.execute('DELETE FROM events WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

// Insert a single event only if one with the same title + start_date is absent.
async function ensureEvent({ title, start, end, color, href, live }) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM events WHERE title = ? AND start_date = ? LIMIT 1',
    [title, start]
  );
  if (rows.length) return false;
  await pool.execute(
    'INSERT INTO events (title, start_date, end_date, color, href, live) VALUES (?, ?, ?, ?, ?, ?)',
    [title, start, end, color || '#d4af37', href || null, live ? 1 : 0]
  );
  console.log(`  Ensured calendar event: ${title}`);
  return true;
}

async function seedEventsIfEmpty() {
  const [rows] = await pool.execute('SELECT COUNT(*) AS c FROM events');
  if (Number(rows[0].c) > 0) return;
  const seed = require('./events-seed');
  const pad = n => String(n).padStart(2, '0');
  const iso = a => `${a[0]}-${pad(a[1])}-${pad(a[2])}`;
  for (const ev of seed) {
    await pool.execute(
      `INSERT INTO events (title, start_date, end_date, color, href, live) VALUES (?, ?, ?, ?, ?, ?)`,
      [ev.t, iso(ev.s), iso(ev.e), ev.c || '#d4af37', ev.h || null, ev.live ? 1 : 0]
    );
  }
  console.log(`  Seeded ${seed.length} calendar events.`);
}

// ─────────────────────────────────────────────────────────────────────────────

// ── Discord verification ───────────────────────────────────────────────────────

async function upsertDiscordVerification(discordId, email, username, guildId) {
  await pool.execute(
    `INSERT INTO discord_verifications (discord_id, email, discord_username, guild_id, verified_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE email=VALUES(email), discord_username=VALUES(discord_username),
                             guild_id=VALUES(guild_id), verified_at=NOW()`,
    [String(discordId), String(email || '').toLowerCase().trim(), String(username || ''), String(guildId || '')]
  );
}

// Which Discord account (if any) already verified with this email?
// Is this email CONFIRMED by staff in an event? (Discord event roles are granted
// on staff confirmation; used to back-fill roles when a user verifies later.)
async function emailInLastAccount(email) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM last_account_applications WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND confirmed = 1 LIMIT 1',
    [String(email || '')]
  );
  return rows.length > 0;
}
async function emailInTheLastDay(email) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM the_last_day_registrations WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND confirmed = 1 LIMIT 1',
    [String(email || '')]
  );
  return rows.length > 0;
}

// Look up the email on a single registration/application (to grant a role on confirm).
async function getLastAccountEmailById(id) {
  const [rows] = await pool.execute('SELECT email FROM last_account_applications WHERE id = ? LIMIT 1', [id]);
  return rows[0] ? rows[0].email : null;
}
async function getTheLastDayEmailById(id) {
  const [rows] = await pool.execute('SELECT email FROM the_last_day_registrations WHERE id = ? LIMIT 1', [id]);
  return rows[0] ? rows[0].email : null;
}

async function getDiscordByEmail(email) {
  const [rows] = await pool.execute(
    'SELECT discord_id, discord_username FROM discord_verifications WHERE email = ? LIMIT 1',
    [String(email || '').toLowerCase().trim()]
  );
  return rows[0] || null;
}

async function getDiscordVerification(discordId) {
  const [rows] = await pool.execute(
    'SELECT * FROM discord_verifications WHERE discord_id = ? LIMIT 1', [String(discordId)]
  );
  return rows[0] || null;
}

// All verified mappings (for the admin lookup + the VPS dashboard bridge).
async function listDiscordVerifications() {
  const [rows] = await pool.execute(
    'SELECT discord_id, email, discord_username, guild_id, verified_at FROM discord_verifications ORDER BY verified_at DESC'
  );
  return rows;
}

// ── Last Account rounds (DB-driven — replaces the hardcoded ROUNDS) ─────────────

async function listLastAccountRounds() {
  const [rows] = await pool.query(
    `SELECT round, label,
            DATE_FORMAT(opens_at,   '%Y-%m-%dT%H:%i:%s') AS opens_at,
            DATE_FORMAT(closes_at,  '%Y-%m-%dT%H:%i:%s') AS closes_at,
            DATE_FORMAT(event_date, '%Y-%m-%d')          AS event_date,
            DATE_FORMAT(event_end,  '%Y-%m-%d')          AS event_end,
            main_seats, reserve_seats, offset_count, closed, event_id
       FROM last_account_rounds ORDER BY round`
  );
  return rows;
}

async function upsertLastAccountRound(r) {
  await pool.execute(
    `INSERT INTO last_account_rounds
       (round, label, opens_at, closes_at, event_date, event_end, main_seats, reserve_seats, offset_count, closed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE label=VALUES(label), opens_at=VALUES(opens_at), closes_at=VALUES(closes_at),
       event_date=VALUES(event_date), event_end=VALUES(event_end), main_seats=VALUES(main_seats),
       reserve_seats=VALUES(reserve_seats), offset_count=VALUES(offset_count), closed=VALUES(closed)`,
    [r.round, r.label, r.opens_at, r.closes_at || null, r.event_date || null, r.event_end || null,
     r.main_seats, r.reserve_seats, r.offset_count || 0, r.closed ? 1 : 0]
  );
}

async function setLastAccountRoundEventId(round, eventId) {
  await pool.execute('UPDATE last_account_rounds SET event_id = ? WHERE round = ?', [eventId || null, round]);
}

async function deleteLastAccountRound(round) {
  const [res] = await pool.execute('DELETE FROM last_account_rounds WHERE round = ?', [round]);
  return res.affectedRows > 0;
}

module.exports = {
  init,
  upsertDiscordVerification, getDiscordByEmail, getDiscordVerification, listDiscordVerifications,
  emailInLastAccount, emailInTheLastDay, getLastAccountEmailById, getTheLastDayEmailById,
  listLastAccountRounds, upsertLastAccountRound, setLastAccountRoundEventId, deleteLastAccountRound,
  findUserByEmail, findUserById, createUser, createUserFull, createMember,
  isEmailEligible, countEligible, addEligibleHashes, refreshVerifiedFromEligible,
  setUserVerified, listUnverifiedUsers,
  upsertOtp, getOtp, incOtpAttempts, deleteOtp,
  createSession, findSession, deleteSession,
  getAllClients, getClientById, createClient, updateClient, deleteClient,
  getDashboardStats, refreshUserStats,
  getProductStats, getProductInvestors,
  createReview, listReviews, deleteReview, toggleReviewFeatured,
  countLastAccountApplications, createLastAccountApplication, listLastAccountApplications, hasLastAccountApplication,
  setLastAccountFlag, lastAccountDashboard,
  getConfirmedStudents, upsertProjectStats, getProjectStats, replaceStudentStats, getRoundStudents,
  listEvents, getEventById, createEvent, updateEvent, deleteEvent,
  searchUsers, deleteUserById, setUserRole, setUserPassword, updateUserProfile,
  countTheLastDayRegistrations, hasTheLastDayRegistration, createTheLastDayRegistration,
  listTheLastDayRegistrations, setTheLastDayFlag,
  getTheLastDayState, setTheLastDayState, deleteUncheckedTheLastDay,
  getActiveTheLastDayEdition, getTheLastDayEditionRow, createNextTheLastDayEdition,
  updateTheLastDayEdition, upsertTheLastDayCalendarEvent,
  getActiveDinnerEdition, getDinnerEditionRow, createNextDinnerEdition,
  updateDinnerEdition, upsertDinnerCalendarEvent,
  countDinnerRegistrations, hasDinnerRegistration, createDinnerRegistration,
  listDinnerRegistrations, setDinnerFlag, getDinnerEmailById, emailInDinner,
  upsertPortfolioAccount, upsertPortfolioDaily, listPortfolioAccounts, getPortfolioDaily,
  upsertMaster, listMasters,
  saveMasterAccount, listMasterAccountsAdmin, listMasterAccountsForFetch, deleteMasterAccount, setMasterActive,
  listOnboardingSteps, addOnboardingStep, updateOnboardingStep, deleteOnboardingStep,
  addOnboardingCustomer, updateOnboardingCustomer, deleteOnboardingCustomer, listOnboardingCustomers,
  setOnboardingProgress, setOnboardingProgressByKey,
};
