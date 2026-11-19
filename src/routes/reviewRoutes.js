const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const authMiddleware = require('../middlewares/authMiddleware');

// 1. Lấy danh sách đánh giá của 1 phim
router.get('/movie/:movieId', reviewController.getReviewsByMovie);

// 2. Viết đánh giá (Yêu cầu đăng nhập)
router.post('/', authMiddleware.verifyToken, reviewController.createReview);

module.exports = router;
