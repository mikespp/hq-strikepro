require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const db                  = require('./db/database');
const { router: authRouter } = require('./routes/auth');
const clientsRouter          = require('./routes/clients');
const dashboardRouter        = require('./routes/dashboard');
const productsRouter         = require('./routes/products');
const reviewsRouter          = require('./routes/reviews');

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
app.use('/api/clients',   clientsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/products',  productsRouter);
app.use('/api/reviews',   reviewsRouter);

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
      console.log(`  HQ Strikepro running at http://localhost:${PORT}\n`);
    });
  })
  .catch(err => {
    console.error('\n  ❌ MySQL connection failed:', err.message);
    console.error('  → Check your .env file (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME)\n');
    process.exit(1);
  });
