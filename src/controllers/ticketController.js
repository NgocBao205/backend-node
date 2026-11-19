const pool = require('../config/db');
const redis = require('../config/redis');

const ticketController = {
    // 1. Giữ ghế tạm thời (Redis Lock NX TTL 300s)
    lockSeat: async (req, res) => {
        try {
            const { seat_id, showtime_id } = req.body;
            const user_id = req.user.id;

            if (!seat_id || !showtime_id) {
                return res.status(400).json({ message: "Thiếu seat_id hoặc showtime_id" });
            }

            // Kiểm tra ghế đã bán trong CSDL chưa
            const checkSold = await pool.query(
                `SELECT id FROM Tickets 
                 WHERE showtime_id = $1 AND seat_id = $2 AND status IN ('Đã thanh toán', 'Đã xác nhận vào rạp')`,
                [showtime_id, seat_id]
            );

            if (checkSold.rows.length > 0) {
                return res.status(409).json({ message: "Ghế này đã được bán vĩnh viễn!" });
            }

            const lockKey = `lock:showtime_${showtime_id}:seat_${seat_id}`;
            const isLocked = await redis.set(lockKey, user_id, { nx: true, ex: 300 });

            if (!isLocked) {
                return res.status(409).json({ 
                    message: "Rất tiếc! Ghế này vừa có người giữ rồi. Vui lòng chọn ghế khác." 
                });
            }

            // Phát sóng thời gian thực cho tất cả client
            const io = req.app.get('socketio');
            if (io) {
                io.emit('seat_locked', { showtime_id, seat_id, status: 'locked' });
                io.emit('seatLocked', seat_id);
            }

            res.status(200).json({
                message: "Giữ ghế thành công! Bạn có 5 phút để thanh toán.",
                seat_id: seat_id,
                expire_in: "5 phút"
            });

        } catch (error) {
            console.error("Lỗi khi giữ ghế:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 2. Nhả ghế (Unlock Seat)
    unlockSeat: async (req, res) => {
        try {
            const { seat_id, showtime_id } = req.body;
            const user_id = req.user.id;

            const lockKey = `lock:showtime_${showtime_id}:seat_${seat_id}`;
            const currentOwner = await redis.get(lockKey);

            if (currentOwner && currentOwner.toString() === user_id.toString()) {
                await redis.del(lockKey);

                const io = req.app.get('socketio');
                if (io) {
                    io.emit('seat_unlocked', { showtime_id, seat_id });
                }
                return res.status(200).json({ message: "Nhả ghế thành công!" });
            }

            res.status(400).json({ message: "Không thể nhả ghế của người khác hoặc khóa đã hết hạn" });
        } catch (error) {
            console.error("Lỗi nhả ghế:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 3. Xem lịch sử vé của người dùng đang đăng nhập
    getMyTickets: async (req, res) => {
        try {
            const user_id = req.user.id;
            const result = await pool.query(
                `SELECT t.id, t.total_price, t.payment_method, t.status,
                        s.start_time, s.end_time,
                        m.title as movie_title, m.poster_url, m.duration,
                        r.name as room_name,
                        st.row_letter, st.seat_number, st.type as seat_type
                 FROM Tickets t
                 JOIN Showtimes s ON t.showtime_id = s.id
                 JOIN Movies m ON s.movie_id = m.id
                 JOIN Rooms r ON s.room_id = r.id
                 LEFT JOIN Seats st ON t.seat_id = st.id
                 WHERE t.user_id = $1
                 ORDER BY t.id DESC`,
                [user_id]
            );

            res.status(200).json(result.rows);
        } catch (error) {
            console.error("Lỗi lấy vé của tôi:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 4. Bán vé tại quầy (Staff POS - Tiền mặt tại quầy)
    staffSellTicket: async (req, res) => {
        try {
            const { showtime_id, seat_id } = req.body;
            const staff_id = req.user.id;

            // Lấy giá vé từ suất chiếu
            const stRes = await pool.query('SELECT base_price FROM Showtimes WHERE id = $1', [showtime_id]);
            if (stRes.rows.length === 0) return res.status(404).json({ message: "Không tìm thấy suất chiếu" });

            const base_price = stRes.rows[0].base_price;

            // Chốt vé ngay vào DB với phương thức tiền mặt
            const ticketRes = await pool.query(
                `INSERT INTO Tickets (user_id, showtime_id, seat_id, total_price, payment_method, status)
                 VALUES ($1, $2, $3, $4, 'Tiền mặt tại quầy', 'Đã xác nhận vào rạp') RETURNING *`,
                [staff_id, showtime_id, seat_id, base_price]
            );

            // Xóa khóa Redis nếu có
            const lockKey = `lock:showtime_${showtime_id}:seat_${seat_id}`;
            await redis.del(lockKey);

            // Bắn Socket.IO cập nhật tức thì màn hình khách hàng online
            const io = req.app.get('socketio');
            if (io) {
                io.emit('seat_sold', { showtime_id, seat_id, status: 'sold' });
            }

            res.status(201).json({
                message: "Xuất vé tại quầy thành công!",
                ticket: ticketRes.rows[0]
            });
        } catch (error) {
            console.error("Lỗi bán vé tại quầy:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 5. Xác nhận vé vào rạp (Staff scan vé)
    verifyTicketEntry: async (req, res) => {
        try {
            const { id } = req.params;
            const result = await pool.query(
                `UPDATE Tickets SET status = 'Đã xác nhận vào rạp' 
                 WHERE id = $1 AND status = 'Đã thanh toán' RETURNING *`,
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(400).json({ message: "Vé không hợp lệ hoặc đã vào rạp từ trước!" });
            }

            res.status(200).json({
                message: "Xác nhận vào rạp thành công!",
                ticket: result.rows[0]
            });
        } catch (error) {
            console.error("Lỗi xác nhận vé:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    }
};

module.exports = ticketController;
