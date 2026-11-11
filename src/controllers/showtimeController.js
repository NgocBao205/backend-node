const pool = require('../config/db');

const showtimeController = {
    createBulk: async (req, res) => {
        const client = await pool.connect();

        try {
            const { movie_id, room_id, start_times, base_price } = req.body;

            // Kiểm tra dữ liệu đầu vào
            if (!movie_id || !room_id || !start_times || start_times.length === 0) {
                return res.status(400).json({ message: "Thiếu thông tin: movie_id, room_id hoặc start_times" });
            }

            await client.query('BEGIN'); // Mở Giao dịch

            // 1. Lấy thời lượng phim để tính toán
            const movieRes = await client.query('SELECT duration FROM Movies WHERE id = $1', [movie_id]);
            if (movieRes.rows.length === 0) {
                throw new Error("Không tìm thấy bộ phim này trong hệ thống!");
            }
            const duration = movieRes.rows[0].duration;

            const insertedShowtimes = [];

            // 2. Vòng lặp rà soát và lưu từng suất chiếu
            for (const startTimeStr of start_times) {
                const start_time = new Date(startTimeStr);
                
                // Thuật toán: Giờ kết thúc = Giờ bắt đầu + Thời lượng phim + 30 phút vệ sinh
                const end_time = new Date(start_time.getTime() + (duration + 30) * 60000); 

                // 3. KIỂM TRA ĐỤNG GIỜ (OVERLAP DETECTION)
                // Hai khung giờ giao nhau khi: (Bắt đầu Mới < Kết thúc Cũ) VÀ (Kết thúc Mới > Bắt đầu Cũ)
                const overlapCheck = await client.query(
                    `SELECT id, start_time, end_time FROM Showtimes 
                     WHERE room_id = $1 
                     AND status != 'Hủy'
                     AND start_time < $3 
                     AND end_time > $2`,
                    [room_id, start_time, end_time]
                );

                if (overlapCheck.rows.length > 0) {
                    // Nếu phát hiện đụng giờ, quăng lỗi ngay để kích hoạt ROLLBACK
                    throw new Error(`Phòng chiếu đã bị kẹt lịch vào khung giờ: ${start_time.toLocaleString('vi-VN')}`);
                }

                // 4. Nếu an toàn, tiến hành chèn vào CSDL (vẫn nằm trong RAM chờ COMMIT)
                const insertRes = await client.query(
                    `INSERT INTO Showtimes (movie_id, room_id, start_time, end_time, base_price, status) 
                     VALUES ($1, $2, $3, $4, $5, 'Sắp chiếu') RETURNING id, start_time, end_time`,
                    [movie_id, room_id, start_time, end_time, base_price || 75000]
                );
                
                insertedShowtimes.push(insertRes.rows[0]);
            }

            await client.query('COMMIT'); // Duyệt qua hết mảng an toàn thì Lưu vĩnh viễn

            res.status(201).json({
                message: "Thêm lịch chiếu hàng loạt thành công!",
                data: insertedShowtimes
            });

        } catch (error) {
            await client.query('ROLLBACK'); // Hủy sạch nếu có 1 ca đụng giờ
            console.error("Lỗi xếp lịch:", error.message);
            res.status(400).json({ message: error.message });
        } finally {
            client.release();
        }
    }
};

module.exports = showtimeController;