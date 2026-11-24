const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');
const authMiddleware = require('../middlewares/authMiddleware');

// 1. Lấy tất cả phòng chiếu (kèm thống kê số hàng, số cột, loại ghế từ bảng Seats)
router.get('/', roomController.getAllRooms);

// 2. Lấy chi tiết phòng chiếu & danh sách ghế
router.get('/:id', roomController.getRoomById);

// 3. Tạo phòng chiếu mới (tự động sinh hàng & cột & ghế)
router.post('/', authMiddleware.verifyAdmin, roomController.createRoom);

// 4. Cập nhật thông tin phòng (Tên phòng, trạng thái Hoạt động / Bảo trì)
router.put('/:id', authMiddleware.verifyAdmin, roomController.updateRoom);

// 5. Cập nhật cấu hình loại ghế (Standard, VIP, Couple)
router.put('/:id/seats', authMiddleware.verifyAdmin, roomController.updateSeatTypes);

// 6. Xóa phòng chiếu (Chặn xóa nếu đã có suất chiếu)
router.delete('/:id', authMiddleware.verifyAdmin, roomController.deleteRoom);

module.exports = router;
