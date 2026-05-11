const express         = require('express');
const db              = require('../db/database');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard  – aggregated stats for the logged-in user
router.get('/', async (req, res) => {
  try {
    const stats = await db.getDashboardStats(req.userId);
    res.json({ stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
