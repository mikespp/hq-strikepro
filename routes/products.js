const express         = require('express');
const db              = require('../db/database');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/products  – summary stats for all products
router.get('/', async (req, res) => {
  try {
    const stats = await db.getProductStats(req.userId);
    res.json({ stats });
  } catch (err) {
    console.error('[products]', err);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  }
});

// GET /api/products/:key  – investor list for one product
// key: ppvp | hq_ultimate | golden_boy
router.get('/:key', async (req, res) => {
  try {
    const investors = await db.getProductInvestors(req.userId, req.params.key);
    if (investors === null) return res.status(404).json({ error: 'Product not found.' });
    res.json({ investors });
  } catch (err) {
    console.error('[products/:key]', err);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  }
});

module.exports = router;
