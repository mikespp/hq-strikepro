const express = require('express');
const db      = require('../db/database');

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
  if (!r || r < 1 || r > 10) {
    return res.status(400).json({ error: 'กรุณาให้คะแนน 1–10 ดาว' });
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

module.exports = router;
