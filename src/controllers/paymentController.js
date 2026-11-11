const pool = require('../config/db');
const redis = require('../config/redis');
const crypto = require('crypto'); // Thư viện mã hóa có sẵn của Node.js

const paymentController = {
    // 1. API Khởi tạo thanh toán
    createPayment: async (req, res) => {
        try {
            const { showtime_id, seat_id, payment_method } = req.body;
            const user_id = req.user.id;

            // KIỂM TRA ZERO TRUST: Chống hacker sửa giá tiền
            // Backend tự động móc DB để lấy base_price thay vì tin tưởng Frontend
            const showtimeRes = await pool.query('SELECT base_price FROM Showtimes WHERE id = $1', [showtime_id]);
            if (showtimeRes.rows.length === 0) return res.status(404).json({ message: "Không tìm thấy suất chiếu" });
            
            const total_price = showtimeRes.rows[0].base_price;

            // MÔ PHỎNG: Tạo dữ liệu giao dịch và ký tên điện tử bằng HMAC SHA-256
            const secretKey = process.env.JWT_SECRET; // Dùng tạm secret key của ta làm khóa của cổng thanh toán
            const rawData = `showtime_id=${showtime_id}&seat_id=${seat_id}&amount=${total_price}`;
            const signature = crypto.createHmac('sha256', secretKey).update(rawData).digest('hex');

            res.status(200).json({
                message: "Tạo link thanh toán thành công!",
                payment_url: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?...", // Mock URL
                // Trả về dữ liệu gốc và chữ ký để lát nữa ta dùng Postman giả lập Webhook VNPAY gọi về
                mock_webhook_data: {
                    user_id,
                    showtime_id,
                    seat_id,
                    amount: total_price,
                    payment_method: payment_method || 'VNPAY',
                    signature: signature
                }
            });
        } catch (error) {
            res.status(500).json({ message: "Lỗi tạo thanh toán" });
        }
    },

    // 2. API Webhook (Cổng thanh toán gọi ẩn về Server của ta sau khi khách quét mã xong)
    webhookIPN: async (req, res) => {
        try {
            const { user_id, showtime_id, seat_id, amount, payment_method, signature } = req.body;

            // BƯỚC 1: BẢO MẬT - ĐỐI CHIẾU CHỮ KÝ (HMAC SHA-256)
            const secretKey = process.env.JWT_SECRET;
            const rawData = `showtime_id=${showtime_id}&seat_id=${seat_id}&amount=${amount}`;
            const serverSignature = crypto.createHmac('sha256', secretKey).update(rawData).digest('hex');

            if (serverSignature !== signature) {
                return res.status(400).json({ message: "Cảnh báo bảo mật: Chữ ký không hợp lệ! Phát hiện gian lận." });
            }

            // BƯỚC 2: NẾU HỢP LỆ -> LƯU VÉ VÀO POSTGRESQL (Chốt vé vĩnh viễn)
            const insertTicket = await pool.query(
                `INSERT INTO Tickets (user_id, showtime_id, seat_id, total_price, payment_method, status) 
                 VALUES ($1, $2, $3, $4, $5, 'Đã thanh toán') RETURNING id`,
                [user_id, showtime_id, seat_id, amount, payment_method]
            );

            // BƯỚC 3: GIẢI PHÓNG KHÓA REDIS SỚM (Không cần đợi 5 phút)
            const lockKey = `lock:showtime_${showtime_id}:seat_${seat_id}`;
            await redis.del(lockKey);

            // BƯỚC 4: PHÁT SÓNG SOCKET.IO BÁO GHẾ ĐÃ BÁN (Tô màu Đỏ)
            const io = req.app.get('socketio');
            io.emit('seat_sold', {
                showtime_id: showtime_id,
                seat_id: seat_id,
                status: 'sold'
            });

            res.status(200).json({ 
                message: "Xác nhận giao dịch thành công! Vé đã được xuất.",
                ticket_id: insertTicket.rows[0].id
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Lỗi xử lý Webhook" });
        }
    }
};

module.exports = paymentController;