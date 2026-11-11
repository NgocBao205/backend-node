const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const authMiddleware = require('../middlewares/authMiddleware');

// Khách hàng phải đăng nhập mới được bình luận
router.post('/', authMiddleware.verifyToken, reviewController.createReview);

module.exports = router;