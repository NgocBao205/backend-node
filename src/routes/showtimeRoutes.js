const express = require('express');
const router = express.Router();
const showtimeController = require('../controllers/showtimeController');
const authMiddleware = require('../middlewares/authMiddleware');
const { autoSyncStatus } = require('../middlewares/autoSyncMiddleware');

// Áp dụng autoSyncStatus cho tất cả các truy vấn xem danh sách / chi tiết suất chiếu
router.use(autoSyncStatus);

// 1. Lấy tất cả suất chiếu (có lọc theo ngày / phòng)
router.get('/', showtimeController.getAllShowtimes);

// 2. Lấy suất chiếu theo ID phim
router.get('/movie/:movieId', showtimeController.getShowtimesByMovie);

// 3. Lấy chi tiết một suất chiếu kèm danh sách ghế đã bán
router.get('/:id', showtimeController.getShowtimeById);

// 4. Bulk xếp lịch chiếu (Chỉ Quản trị viên)
router.post('/bulk', authMiddleware.verifyAdmin, showtimeController.createBulk);

// 5. Cập nhật suất chiếu (Đổi phòng/giờ/giá - Kiểm tra vé đã đặt & đụng lịch)
router.put('/:id', authMiddleware.verifyAdmin, showtimeController.updateShowtime);

// 6. Xóa hoặc Hủy suất chiếu (Xóa nếu chưa có vé, Hủy nếu đã có vé)
router.delete('/:id', authMiddleware.verifyAdmin, showtimeController.deleteOrCancelShowtime);

module.exports = router;
