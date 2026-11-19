const express = require('express');
const router = express.Router();
const showtimeController = require('../controllers/showtimeController');
const authMiddleware = require('../middlewares/authMiddleware');

// 1. Lấy tất cả suất chiếu (có lọc theo ngày / phòng)
router.get('/', showtimeController.getAllShowtimes);

// 2. Lấy suất chiếu theo ID phim
router.get('/movie/:movieId', showtimeController.getShowtimesByMovie);

// 3. Lấy chi tiết một suất chiếu kèm danh sách ghế đã bán
router.get('/:id', showtimeController.getShowtimeById);

// 4. Bulk xếp lịch chiếu (Chỉ Quản trị viên)
router.post('/bulk', authMiddleware.verifyAdmin, showtimeController.createBulk);

module.exports = router;
