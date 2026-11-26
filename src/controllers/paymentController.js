const pool = require('../config/db');
const redis = require('../config/redis');
const crypto = require('crypto'); // Thư viện mã hóa có sẵn của Node.js

const paymentController = {
    // 1. API Khởi tạo thanh toán VietQR / VNPAY (Hỗ trợ 1 hoặc nhiều ghế)
    createPayment: async (req, res) => {
        try {
            const { showtime_id, seat_id, seat_ids, payment_method } = req.body;
            const user_id = req.user.id;

            const seatsList = Array.isArray(seat_ids) && seat_ids.length > 0 
                ? seat_ids 
                : (seat_id ? [seat_id] : []);

            if (seatsList.length === 0 || !showtime_id) {
                return res.status(400).json({ message: "Thiếu thông tin ghế hoặc showtime_id" });
            }

            // KIỂM TRA ZERO TRUST: Lấy base_price và thông tin ghế thực tế từ DB
            const showtimeRes = await pool.query(
                `SELECT s.base_price, s.room_id, m.title as movie_title, r.name as room_name 
                 FROM Showtimes s 
                 JOIN Movies m ON s.movie_id = m.id
                 JOIN Rooms r ON s.room_id = r.id
                 WHERE s.id = $1`, 
                [showtime_id]
            );
            if (showtimeRes.rows.length === 0) return res.status(404).json({ message: "Không tìm thấy suất chiếu" });
            
            const base_price = Number(showtimeRes.rows[0].base_price);

            // Truy vấn loại ghế thực tế của các ghế được chọn để tính phụ thu
            const seatsDetailRes = await pool.query(
                `SELECT id, row_letter, seat_number, type FROM Seats WHERE room_id = $1 AND id = ANY($2)`,
                [showtimeRes.rows[0].room_id, seatsList]
            );

            let total_amount = 0;
            const seatNames = [];

            seatsList.forEach(sId => {
                const sObj = seatsDetailRes.rows.find(r => r.id === Number(sId));
                let seatPrice = base_price;
                if (sObj) {
                    seatNames.push(`${sObj.row_letter}${sObj.seat_number}`);
                    if (sObj.type === 'VIP') seatPrice += 15000;
                    else if (sObj.type === 'Couple') seatPrice += 30000;
                } else {
                    seatNames.push(`Ghế #${sId}`);
                }
                total_amount += seatPrice;
            });

            // Sinh mã booking code bảo mật cao chuẩn hệ thống rạp: CNV + Timestamp + 4 ký tự ngẫu nhiên
            const randomCode = crypto.randomBytes(3).toString('hex').toUpperCase();
            const bookingCode = `CNV${Date.now().toString().slice(-6)}${randomCode}`;

            // Thông tin tài khoản ngân hàng Vietcombank chính thức của rạp
            const BANK_ID = "VCB"; // Ngân hàng Vietcombank (Napas code: 970436)
            const ACCOUNT_NO = "1040346083"; 
            const ACCOUNT_NAME = "TRAN NGOC BAO";

            // Tạo link ảnh VietQR động chuẩn Napas 247
            const qrUrl = `https://img.vietqr.io/image/${BANK_ID}-${ACCOUNT_NO}-compact2.png?amount=${total_amount}&addInfo=${bookingCode}&accountName=${encodeURIComponent(ACCOUNT_NAME)}`;

            // Ký số bảo mật HMAC SHA-256
            const secretKey = process.env.JWT_SECRET || 'MahoaToken$?';
            const rawData = `showtime_id=${showtime_id}&seat_ids=${seatsList.join(',')}&amount=${total_amount}&bookingCode=${bookingCode}`;
            const signature = crypto.createHmac('sha256', secretKey).update(rawData).digest('hex');

            res.status(200).json({
                message: "Tạo thông tin thanh toán VietQR thành công!",
                booking_code: bookingCode,
                qr_url: qrUrl,
                bank_info: {
                    bank: "Vietcombank (Ngân hàng Ngoại Thương)",
                    account_no: ACCOUNT_NO,
                    account_name: ACCOUNT_NAME,
                    amount: total_amount,
                    content: bookingCode
                },
                movie_title: showtimeRes.rows[0].movie_title,
                room_name: showtimeRes.rows[0].room_name,
                seats: seatNames,
                mock_webhook_data: {
                    user_id,
                    showtime_id,
                    seat_ids: seatsList,
                    amount: total_amount,
                    booking_code: bookingCode,
                    payment_method: payment_method || 'VietQR',
                    signature: signature
                }
            });
        } catch (error) {
            console.error("Lỗi tạo thanh toán:", error);
            res.status(500).json({ message: "Lỗi tạo thanh toán" });
        }
    },

    // 2. API Webhook / Xác nhận thanh toán (Chốt vé vào DB và xóa Redis Lock)
    webhookIPN: async (req, res) => {
        try {
            const { user_id, showtime_id, seat_id, seat_ids, amount, booking_code, payment_method, signature } = req.body;

            const seatsList = Array.isArray(seat_ids) && seat_ids.length > 0 
                ? seat_ids 
                : (seat_id ? [seat_id] : []);

            // BƯỚC 1: BẢO MẬT - ĐỐI CHIẾU CHỮ KÝ (HMAC SHA-256)
            const secretKey = process.env.JWT_SECRET || 'MahoaToken$?';
            const rawData = `showtime_id=${showtime_id}&seat_ids=${seatsList.join(',')}&amount=${amount}&bookingCode=${booking_code}`;
            const serverSignature = crypto.createHmac('sha256', secretKey).update(rawData).digest('hex');

            if (serverSignature !== signature) {
                return res.status(400).json({ message: "Cảnh báo bảo mật: Chữ ký không hợp lệ! Phát hiện gian lận." });
            }

            // BƯỚC 2: NẾU HỢP LỆ -> LƯU VÉ VÀO POSTGRESQL (Chốt vé vĩnh viễn)
            const io = req.app.get('socketio');
            const createdTicketIds = [];
            const pricePerSeat = Math.round(Number(amount) / seatsList.length);

            // Map payment_method về các giá trị hợp lệ trong Check Constraint: 'Tiền mặt tại quầy', 'VNPAY', 'MoMo'
            const validPaymentMethod = (payment_method === 'MoMo') ? 'MoMo' : 'VNPAY';

            for (const sId of seatsList) {
                // Mỗi vé có booking_code duy nhất nếu đặt nhiều ghế (ví dụ: CNV84920-1, CNV84920-2)
                const ticketBookingCode = seatsList.length > 1 ? `${booking_code}-${sId}` : booking_code;

                const insertTicket = await pool.query(
                    `INSERT INTO Tickets (booking_code, user_id, showtime_id, seat_id, total_price, payment_method, status) 
                     VALUES ($1, $2, $3, $4, $5, $6, 'Đã thanh toán') RETURNING id`,
                    [ticketBookingCode, user_id, showtime_id, sId, pricePerSeat, validPaymentMethod]
                );
                createdTicketIds.push(insertTicket.rows[0].id);

                // GIẢI PHÓNG KHÓA REDIS
                await redis.del(`lock:showtime_${showtime_id}:seat_${sId}`);

                // BẮN SOCKET.IO BÁO GHẾ ĐÃ BÁN (Tô màu Đỏ)
                if (io) {
                    io.emit('seat_sold', {
                        showtime_id: showtime_id,
                        seat_id: sId,
                        status: 'sold'
                    });
                }
            }

            // TÍCH ĐIỂM THƯỞNG CINEVIE REWARDS: 1.000đ được 1 điểm
            const pointsEarned = Math.floor(Number(amount) / 1000);
            if (pointsEarned > 0) {
                await pool.query(
                    `UPDATE Users SET loyalty_points = COALESCE(loyalty_points, 0) + $1 WHERE id = $2`,
                    [pointsEarned, user_id]
                );
            }

            res.status(200).json({ 
                message: "Xác nhận giao dịch thành công! Vé đã được xuất.",
                booking_code: booking_code,
                ticket_ids: createdTicketIds,
                points_earned: pointsEarned
            });

        } catch (error) {
            console.error("Lỗi Webhook IPN:", error);
            res.status(500).json({ message: "Lỗi xử lý Webhook" });
        }
    }
};

module.exports = paymentController;