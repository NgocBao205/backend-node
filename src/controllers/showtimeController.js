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

    // 2. Lấy tất cả suất chiếu (có bộ lọc theo ngày, phòng, trạng thái, tìm kiếm phim, phân trang, đếm booked_count)
    getAllShowtimes: async (req, res) => {
        try {
            const { date, room_id, status, search, page = 1, limit = 10, all = 'false' } = req.query;

            let query = `
                SELECT 
                    s.*, 
                    r.name as room_name, 
                    r.capacity, 
                    m.title as movie_title, 
                    m.poster_url, 
                    m.duration,
                    COUNT(t.id) as booked_tickets_count
                FROM Showtimes s
                JOIN Rooms r ON s.room_id = r.id
                JOIN Movies m ON s.movie_id = m.id
                LEFT JOIN Tickets t ON s.id = t.showtime_id AND t.status IN ('Đã thanh toán', 'Đã xác nhận vào rạp')
            `;
            const conditions = [];
            const values = [];

            if (status) {
                values.push(status);
                conditions.push(`s.status = $${values.length}`);
            }

            if (room_id) {
                values.push(room_id);
                conditions.push(`s.room_id = $${values.length}`);
            }

            if (date) {
                values.push(date);
                conditions.push(`DATE(s.start_time) = $${values.length}`);
            }

            if (search) {
                values.push(`%${search}%`);
                conditions.push(`m.title ILIKE $${values.length}`);
            }

            if (conditions.length > 0) {
                query += ` WHERE ${conditions.join(' AND ')}`;
            }

            query += ` GROUP BY s.id, r.name, r.capacity, m.title, m.poster_url, m.duration ORDER BY s.start_time DESC`;

            if (all !== 'true') {
                const countRes = await pool.query(`SELECT COUNT(*) FROM (${query}) as total_count`, values);
                const totalItems = parseInt(countRes.rows[0].count);

                const offset = (parseInt(page) - 1) * parseInt(limit);
                values.push(parseInt(limit));
                query += ` LIMIT $${values.length}`;
                values.push(offset);
                query += ` OFFSET $${values.length}`;

                const result = await pool.query(query, values);
                return res.status(200).json({
                    data: result.rows,
                    pagination: {
                        total: totalItems,
                        page: parseInt(page),
                        limit: parseInt(limit),
                        totalPages: Math.ceil(totalItems / parseInt(limit))
                    }
                });
            }

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

            // Lấy toàn bộ danh sách ghế thực tế trong phòng chiếu từ bảng seats
            const seatsRes = await pool.query(
                `SELECT id, row_letter, seat_number, type 
                 FROM Seats 
                 WHERE room_id = $1 
                 ORDER BY row_letter ASC, seat_number ASC`,
                [showtime.room_id]
            );
            showtime.seats = seatsRes.rows;

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

    // 4. Sửa suất chiếu (PUT /api/showtimes/:id)
    updateShowtime: async (req, res) => {
        try {
            const { id } = req.params;
            const { room_id, start_time, base_price, status } = req.body;

            // Kiểm tra xem suất chiếu này đã có vé đặt chưa
            const ticketCheck = await pool.query(
                `SELECT COUNT(*) FROM Tickets WHERE showtime_id = $1 AND status IN ('Đã thanh toán', 'Đã xác nhận vào rạp')`,
                [id]
            );
            const bookedCount = parseInt(ticketCheck.rows[0].count);

            const currentStRes = await pool.query(`SELECT s.*, m.duration FROM Showtimes s JOIN Movies m ON s.movie_id = m.id WHERE s.id = $1`, [id]);
            if (currentStRes.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy suất chiếu" });
            }

            const currentSt = currentStRes.rows[0];

            // Nếu đã có vé đặt thì không cho đổi giờ hoặc phòng (để bảo vệ quyền lợi của khách)
            if (bookedCount > 0 && (start_time || room_id)) {
                return res.status(400).json({ 
                    message: `Suất chiếu đã có ${bookedCount} vé được bán! Không thể thay đổi giờ hoặc phòng chiếu. Bạn chỉ có thể cập nhật trạng thái (Hủy).` 
                });
            }

            const targetRoomId = room_id || currentSt.room_id;
            const targetStartTime = start_time ? new Date(start_time) : new Date(currentSt.start_time);
            const targetEndTime = new Date(targetStartTime.getTime() + (currentSt.duration + 30) * 60000);

            // Kiểm tra đụng lịch nếu có đổi giờ hoặc đổi phòng
            if (start_time || room_id) {
                const overlapCheck = await pool.query(
                    `SELECT id FROM Showtimes 
                     WHERE room_id = $1 
                     AND id != $2
                     AND status != 'Hủy'
                     AND start_time < $4 
                     AND end_time > $3`,
                    [targetRoomId, id, targetStartTime, targetEndTime]
                );

                if (overlapCheck.rows.length > 0) {
                    return res.status(400).json({ 
                        message: `Phòng chiếu đã bị trùng lịch với một suất chiếu khác trong khung giờ này!` 
                    });
                }
            }

            const updateRes = await pool.query(
                `UPDATE Showtimes 
                 SET room_id = $1,
                     start_time = $2,
                     end_time = $3,
                     base_price = COALESCE($4, base_price),
                     status = COALESCE($5, status)
                 WHERE id = $6 RETURNING *`,
                [targetRoomId, targetStartTime, targetEndTime, base_price, status, id]
            );

            res.status(200).json({
                message: "Cập nhật suất chiếu thành công!",
                showtime: updateRes.rows[0]
            });
        } catch (error) {
            console.error("Lỗi sửa suất chiếu:", error);
            res.status(500).json({ message: error.message || "Lỗi máy chủ nội bộ" });
        }
    },

    // 5. Xóa hoặc Hủy suất chiếu (DELETE /api/showtimes/:id)
    deleteOrCancelShowtime: async (req, res) => {
        try {
            const { id } = req.params;

            // Kiểm tra xem đã có vé đặt chưa
            const ticketCheck = await pool.query(
                `SELECT COUNT(*) FROM Tickets WHERE showtime_id = $1 AND status IN ('Đã thanh toán', 'Đã xác nhận vào rạp')`,
                [id]
            );
            const bookedCount = parseInt(ticketCheck.rows[0].count);

            if (bookedCount > 0) {
                // Đã có vé đặt -> Chuyển sang trạng thái 'Hủy' để đối soát lịch sử
                await pool.query("UPDATE Showtimes SET status = 'Hủy' WHERE id = $1", [id]);
                return res.status(200).json({
                    action: 'cancelled',
                    message: `Suất chiếu đã có ${bookedCount} vé được mua. Hệ thống đã chuyển trạng thái sang "Hủy" để bảo toàn lịch sử hóa đơn!`
                });
            }

            // Chưa có ai đặt vé -> Xóa vĩnh viễn an toàn khỏi Database
            const deleteRes = await pool.query("DELETE FROM Showtimes WHERE id = $1 RETURNING id", [id]);
            if (deleteRes.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy suất chiếu để xóa" });
            }

            res.status(200).json({
                action: 'deleted',
                message: "Đã xóa vĩnh viễn suất chiếu thành công!"
            });
        } catch (error) {
            console.error("Lỗi xóa/hủy suất chiếu:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 6. Bulk xếp lịch chiếu có thuật toán chặn đụng giờ & rollback an toàn
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

                if (isNaN(start_time.getTime())) {
                    throw new Error(`Định dạng thời gian không hợp lệ: ${startTimeStr}`);
                }

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
                message: `Thêm thành công ${insertedShowtimes.length} suất chiếu hàng loạt vào hệ thống!`,
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
