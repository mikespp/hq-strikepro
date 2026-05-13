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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Never cache HTML pages so browsers always get the latest version
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Stream video files with proper range-request support (required for seek/play)
app.get('/videos/:filename', (req, res) => {
  const filename  = path.basename(req.params.filename);
  const videoPath = path.join(__dirname, 'public', 'videos', filename);

  if (!fs.existsSync(videoPath)) return res.status(404).end();

  const stat     = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range    = req.headers.range;

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start     = parseInt(startStr, 10);
    const end       = endStr ? Math.min(parseInt(endStr, 10), fileSize - 1) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': chunkSize,
      'Content-Type':   'video/mp4',
    });
    fs.createReadStream(videoPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type':   'video/mp4',
      'Accept-Ranges':  'bytes',
    });
    fs.createReadStream(videoPath).pipe(res);
  }
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

// /reviews → serve public reviews page
app.get('/reviews', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reviews.html'));
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
