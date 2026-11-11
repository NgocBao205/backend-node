const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const authMiddleware = require('../middlewares/authMiddleware');

// Khách hàng gọi để lấy link thanh toán
router.post('/create-url', authMiddleware.verifyToken, paymentController.createPayment);

// Cổng thanh toán (VNPAY/MoMo) gọi về Server (Không cần Token vì đây là Server-to-Server)
router.post('/webhook', paymentController.webhookIPN);

module.exports = router;