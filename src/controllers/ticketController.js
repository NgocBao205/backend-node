const redis = require('../config/redis');

const ticketController = {
    // API Giữ ghế tạm thời (Lock Seat)
    lockSeat: async (req, res) => {
        try {
            // Lấy ID ghế và ID suất chiếu từ Frontend gửi lên
            const { seat_id, showtime_id } = req.body;
            // Lấy ID của người dùng từ Token đăng nhập (do authMiddleware cung cấp)
            const user_id = req.user.id;

            if (!seat_id || !showtime_id) {
                return res.status(400).json({ message: "Thiếu seat_id hoặc showtime_id" });
            }

            // 1. TẠO CHÌA KHÓA DUY NHẤT CHO GHẾ NÀY
            // Định dạng: lock:showtime_1:seat_25 (Khóa ghế 25 của suất chiếu 1)
            const lockKey = `lock:showtime_${showtime_id}:seat_${seat_id}`;

            // 2. CỐ GẮNG GIÀNH Ổ KHÓA TRÊN REDIS
            // Lệnh SET với tùy chọn NX (Chỉ set nếu key chưa tồn tại) và EX 300 (Hết hạn sau 5 phút = 300 giây)
            const isLocked = await redis.set(lockKey, user_id, { nx: true, ex: 300 });

            // 3. XỬ LÝ KẾT QUẢ TRANH CHẤP
            if (!isLocked) {
                // Nếu isLocked trả về null/false -> Đã có người khác giữ ghế này rồi
                return res.status(409).json({ 
                    message: "Rất tiếc! Ghế này vừa có người nhanh tay hơn giữ rồi. Vui lòng chọn ghế khác." 
                });
            }

            // 4. NẾU GIÀNH KHÓA THÀNH CÔNG -> PHÁT SÓNG THỜI GIAN THỰC
            // Lấy máy chủ Socket.IO đã được lưu ở file index.js ra
            const io = req.app.get('socketio');
            
            // Phát loa thông báo cho TẤT CẢ mọi người biết ghế này đã bị khóa
            io.emit('seat_locked', {
                showtime_id: showtime_id,
                seat_id: seat_id,
                status: 'locked'
            });

            // 5. TRẢ KẾT QUẢ CHO NGƯỜI ĐẶT
            res.status(200).json({
                message: "Giữ ghế thành công! Bạn có 5 phút để thanh toán.",
                seat_id: seat_id,
                expire_in: "5 phút"
            });

        } catch (error) {
            console.error("Lỗi khi giữ ghế:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    }
};

module.exports = ticketController;