const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');

// Khai báo các đường dẫn API
router.post('/register', authController.register);
router.post('/login', authController.login);

router.get('/profile', authMiddleware.verifyToken, (req, res) => {
    // Nếu được vào đây, nghĩa là verifyToken đã gọi next()
    // Ta có thể lấy id và role của user từ req.user
    res.status(200).json({
        message: "Xem thông tin cá nhân!",
        userInfo: req.user
    });
});

module.exports = router;