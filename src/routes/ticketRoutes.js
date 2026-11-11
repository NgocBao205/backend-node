const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const authMiddleware = require('../middlewares/authMiddleware');

// Khách hàng phải đăng nhập (có Token) mới được gọi API này
router.post('/lock-seat', authMiddleware.verifyToken, ticketController.lockSeat);

module.exports = router;