require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const db                  = require('./db/database');
const { router: authRouter } = require('./routes/auth');
const clientsRouter          = require('./routes/clients');
const dashboardRouter        = require('./routes/dashboard');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth',      authRouter);
app.use('/api/clients',   clientsRouter);
app.use('/api/dashboard', dashboardRouter);

// Health check
app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

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
