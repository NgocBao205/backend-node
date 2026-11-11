const express = require('express');
const router = express.Router();
const showtimeController = require('../controllers/showtimeController');
const authMiddleware = require('../middlewares/authMiddleware');

// Route này bắt buộc phải là Admin mới được gọi
router.post('/bulk', authMiddleware.verifyToken, authMiddleware.verifyAdmin, showtimeController.createBulk);

module.exports = router;