const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');

// Khai báo các đường dẫn API
router.post('/register', authController.register);
router.post('/login', authController.login);

// Quên mật khẩu & Đặt lại mật khẩu qua OTP thật bằng Gmail
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Đăng nhập / Đăng ký thật qua Google OAuth Token
router.post('/google', authController.googleAuth);

// Gửi form Liên hệ tới email cinemavnam@gmail.com
router.post('/contact', authController.sendContactMail);

router.get('/profile', authMiddleware.verifyToken, (req, res) => {
    res.status(200).json({
        message: "Xem thông tin cá nhân!",
        userInfo: req.user
    });
});

module.exports = router;
