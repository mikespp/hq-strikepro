require('dotenv').config();

// Prefer IPv4 for outbound connections — Railway's IPv6 route to Gmail SMTP
// is unreachable (ESOCKET ENETUNREACH), which broke OTP email delivery.
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (_) {}

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const db                  = require('./db/database');
const { router: authRouter } = require('./routes/auth');
const { mailerStatus }       = require('./lib/mailer');
const reviewsRouter          = require('./routes/reviews');
const lastAccountRouter      = require('./routes/last-account');
const theLastDayRouter       = require('./routes/the-last-day');
const eventsRouter           = require('./routes/events');
const usersRouter            = require('./routes/users');
const eligibilityRouter      = require('./routes/eligibility');
const discordRouter          = require('./routes/discord');
const discordBot             = require('./lib/discord-bot');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Never cache HTML pages so browsers always get the latest version
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Serve video files
app.get('/videos/:filename', (req, res) => {
  const filename  = path.basename(req.params.filename);
  const videoPath = path.join(__dirname, 'public', 'videos', filename);
  res.sendFile(videoPath, err => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth',      authRouter);
app.use('/api/reviews',   reviewsRouter);
app.use('/api/last-account', lastAccountRouter);
app.use('/api/the-last-day', theLastDayRouter);
app.use('/api/events',    eventsRouter);
app.use('/api/users',     usersRouter);
app.use('/api/eligibility', eligibilityRouter);
app.use('/api/discord',   discordRouter);

// Health check
app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Favicon — serve PNG so Chrome tab shows the logo
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon-32.png'));
});

// /login → serve login.html
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// /register → serve register.html
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// /update-profile → serve profile update page
app.get('/update-profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'update-profile.html'));
});

// /events/unlock-your-wealth → serve event page
app.get('/events/unlock-your-wealth', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'events', 'unlock-your-wealth.html'));
});

// /events/sbc → serve SBC event page
app.get('/events/sbc', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'events', 'sbc.html'));
});

// /events/last-account → serve บ้านหลังสุดท้าย event page
app.get('/events/last-account', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'events', 'last-account.html'));
});

// /events/last-account-apply → serve บ้านหลังสุดท้าย application form
app.get('/events/last-account-apply', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'events', 'last-account-apply.html'));
});

// /last-account-admin → serve บ้านหลังสุดท้าย applicants admin page
app.get('/last-account-admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'last-account-admin.html'));
});

// /events/the-last-day → serve The Last Day info + registration page
app.get('/events/the-last-day', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'events', 'the-last-day.html'));
});

// /the-last-day-admin → serve The Last Day registrants admin page
app.get('/the-last-day-admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'the-last-day-admin.html'));
});

// /users-admin → serve user management page
app.get('/users-admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'users-admin.html'));
});

// /discord-admin → serve Discord verifications lookup page
app.get('/discord-admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'discord-admin.html'));
});

// /reviews → serve public reviews page
app.get('/reviews', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reviews.html'));
});

// /reviews-admin → serve internal reviews management page
app.get('/reviews-admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reviews-admin.html'));
});

// /ecosystem/world-champions → serve World Champions 100 page
app.get('/ecosystem/world-champions', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ecosystem', 'world-champions.html'));
});

// Serve index.html for all non-API routes (SPA fallback)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found.' });
  }
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// Connect to MySQL first, then start server
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`  HQ Strikepro running at http://localhost:${PORT}`);
      console.log(`  ✉  Mail provider: ${mailerStatus()}\n`);
      discordBot.start();   // no-op if DISCORD_BOT_TOKEN is unset
    });
  })
  .catch(err => {
    console.error('\n  ❌ MySQL connection failed:', err.message);
    console.error('  → Check your .env file (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME)\n');
    process.exit(1);
  });
