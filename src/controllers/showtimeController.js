const pool = require('../config/db');

const showtimeController = {
    // 1. Lấy danh sách suất chiếu cho 1 bộ phim
    getShowtimesByMovie: async (req, res) => {
        try {
            const { movieId } = req.params;
            const result = await pool.query(
                `SELECT s.*, r.name as room_name, r.capacity, m.title as movie_title, m.duration, m.poster_url
                 FROM Showtimes s
                 JOIN Rooms r ON s.room_id = r.id
                 JOIN Movies m ON s.movie_id = m.id
                 WHERE s.movie_id = $1 AND s.start_time >= NOW() - INTERVAL '15 minutes' AND s.status != 'Hủy'
                 ORDER BY s.start_time ASC`,
                [movieId]
            );
            res.status(200).json(result.rows);
        } catch (error) {
            console.error("Lỗi lấy suất chiếu theo phim:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 2. Lấy tất cả suất chiếu (có bộ lọc theo ngày & phòng)
    getAllShowtimes: async (req, res) => {
        try {
            const { date, room_id } = req.query;
            let query = `
                SELECT s.*, r.name as room_name, m.title as movie_title, m.poster_url, m.duration
                FROM Showtimes s
                JOIN Rooms r ON s.room_id = r.id
                JOIN Movies m ON s.movie_id = m.id
            `;
            const conditions = ["s.status != 'Hủy'"];
            const values = [];

            if (room_id) {
                values.push(room_id);
                conditions.push(`s.room_id = $${values.length}`);
            }

            if (date) {
                values.push(date);
                conditions.push(`DATE(s.start_time) = $${values.length}`);
            }

            query += ` WHERE ${conditions.join(' AND ')} ORDER BY s.start_time ASC`;

            const result = await pool.query(query, values);
            res.status(200).json(result.rows);
        } catch (error) {
            console.error("Lỗi lấy danh sách suất chiếu:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 3. Lấy chi tiết một suất chiếu kèm sơ đồ ghế và trạng thái đã đặt
    getShowtimeById: async (req, res) => {
        try {
            const { id } = req.params;

            // Thông tin suất chiếu
            const showtimeRes = await pool.query(
                `SELECT s.*, r.name as room_name, r.capacity, m.title as movie_title, m.poster_url, m.duration
                 FROM Showtimes s
                 JOIN Rooms r ON s.room_id = r.id
                 JOIN Movies m ON s.movie_id = m.id
                 WHERE s.id = $1`,
                [id]
            );

            if (showtimeRes.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy suất chiếu này!" });
            }

            const showtime = showtimeRes.rows[0];

            // Lấy danh sách các vé đã thanh toán của suất chiếu này
            const bookedSeatsRes = await pool.query(
                `SELECT seat_id FROM Tickets 
                 WHERE showtime_id = $1 AND status IN ('Đã thanh toán', 'Đã xác nhận vào rạp')`,
                [id]
            );

            showtime.booked_seats = bookedSeatsRes.rows.map(row => row.seat_id);

            res.status(200).json(showtime);
        } catch (error) {
            console.error("Lỗi chi tiết suất chiếu:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 4. Bulk xếp lịch chiếu có thuật toán chặn đụng giờ & rollback an toàn
    createBulk: async (req, res) => {
        const client = await pool.connect();

        try {
            const { movie_id, room_id, start_times, base_price } = req.body;

            if (!movie_id || !room_id || !start_times || start_times.length === 0) {
                return res.status(400).json({ message: "Thiếu thông tin: movie_id, room_id hoặc start_times" });
            }

            await client.query('BEGIN');

            const movieRes = await client.query('SELECT duration FROM Movies WHERE id = $1', [movie_id]);
            if (movieRes.rows.length === 0) {
                throw new Error("Không tìm thấy bộ phim này trong hệ thống!");
            }
            const duration = movieRes.rows[0].duration;

            const insertedShowtimes = [];

            for (const startTimeStr of start_times) {
                const start_time = new Date(startTimeStr);

                if (start_time < new Date()) {
                    throw new Error(`Không thể xếp lịch trong quá khứ: ${start_time.toLocaleString('vi-VN')}`);
                }
                
                // Giờ kết thúc = Giờ bắt đầu + Thời lượng phim + 30 phút vệ sinh rạp
                const end_time = new Date(start_time.getTime() + (duration + 30) * 60000); 

                // Thuật toán Overlap Detection:
                const overlapCheck = await client.query(
                    `SELECT id, start_time, end_time FROM Showtimes 
                     WHERE room_id = $1 
                     AND status != 'Hủy'
                     AND start_time < $3 
                     AND end_time > $2`,
                    [room_id, start_time, end_time]
                );

                if (overlapCheck.rows.length > 0) {
                    throw new Error(`Phòng chiếu đã bị kẹt lịch vào khung giờ: ${start_time.toLocaleString('vi-VN')}`);
                }

                const insertRes = await client.query(
                    `INSERT INTO Showtimes (movie_id, room_id, start_time, end_time, base_price, status) 
                     VALUES ($1, $2, $3, $4, $5, 'Sắp chiếu') RETURNING id, start_time, end_time`,
                    [movie_id, room_id, start_time, end_time, base_price || 75000]
                );
                
                insertedShowtimes.push(insertRes.rows[0]);
            }

            await client.query('COMMIT');

            res.status(201).json({
                message: "Thêm lịch chiếu hàng loạt thành công!",
                data: insertedShowtimes
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Lỗi xếp lịch:", error.message);
            res.status(400).json({ message: error.message });
        } finally {
            client.release();
        }
    }
};

module.exports = showtimeController;
