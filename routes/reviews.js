const express = require('express');
const db      = require('../db/database');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();

// ── GET /api/reviews  (public — no auth required) ────────────────────────────
router.get('/', async (req, res) => {
  try {
    const reviews = await db.listReviews();
    res.json(reviews);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── POST /api/reviews  (public — no auth required) ───────────────────────────
router.post('/', async (req, res) => {
  const { reviewer, product, rating, message, image_data } = req.body;

  if (!reviewer || !reviewer.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อผู้รีวิว' });
  }
  const r = parseInt(rating, 10);
  if (!r || r < 1 || r > 5) {
    return res.status(400).json({ error: 'กรุณาให้คะแนน 1–5 ดาว' });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกข้อความรีวิว' });
  }

  try {
    const id = await db.createReview({
      reviewer:   reviewer.trim(),
      product:    (product || '').trim(),
      rating:     r,
      message:    message.trim(),
      image_data: image_data || null,
    });
    res.status(201).json({ success: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── DELETE /api/reviews/:id  (admin required) ────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const ok = await db.deleteReview(id);
    if (!ok) return res.status(404).json({ error: 'Review not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── PATCH /api/reviews/:id/feature  (admin required) ─────────────────────────
router.patch('/:id/feature', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const row = await db.toggleReviewFeatured(id);
    if (!row) return res.status(404).json({ error: 'Review not found' });
    res.json({ success: true, featured: !!row.featured });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
