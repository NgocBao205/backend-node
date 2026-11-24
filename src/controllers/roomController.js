const pool = require('../config/db');

const roomController = {
    // 1. Lấy danh sách tất cả phòng chiếu kèm thống kê số hàng, số cột, tổng ghế và số lượng theo loại ghế
    getAllRooms: async (req, res) => {
        try {
            const query = `
                SELECT 
                    r.*,
                    COUNT(s.id)::int as total_seats,
                    COUNT(DISTINCT s.row_letter)::int as total_rows,
                    COALESCE(MAX(s.seat_number), 0)::int as max_cols,
                    COUNT(CASE WHEN s.type = 'Standard' THEN 1 END)::int as standard_seats,
                    COUNT(CASE WHEN s.type = 'VIP' THEN 1 END)::int as vip_seats,
                    COUNT(CASE WHEN s.type = 'Couple' THEN 1 END)::int as couple_seats,
                    EXISTS (SELECT 1 FROM Showtimes st WHERE st.room_id = r.id) as has_showtimes
                FROM Rooms r
                LEFT JOIN Seats s ON r.id = s.room_id
                GROUP BY r.id
                ORDER BY r.id ASC
            `;
            const result = await pool.query(query);
            res.status(200).json(result.rows);
        } catch (error) {
            console.error("Lỗi lấy danh sách phòng:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 2. Lấy chi tiết phòng chiếu và toàn bộ danh sách ghế thực tế
    getRoomById: async (req, res) => {
        try {
            const { id } = req.params;
            const roomRes = await pool.query(`
                SELECT 
                    r.*,
                    COUNT(s.id)::int as total_seats,
                    COUNT(DISTINCT s.row_letter)::int as total_rows,
                    COALESCE(MAX(s.seat_number), 0)::int as max_cols,
                    EXISTS (SELECT 1 FROM Showtimes st WHERE st.room_id = r.id) as has_showtimes
                FROM Rooms r
                LEFT JOIN Seats s ON r.id = s.room_id
                WHERE r.id = $1
                GROUP BY r.id
            `, [id]);

            if (roomRes.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy phòng chiếu!" });
            }

            const seatsRes = await pool.query(
                'SELECT * FROM Seats WHERE room_id = $1 ORDER BY row_letter ASC, seat_number ASC',
                [id]
            );

            const room = roomRes.rows[0];
            room.seats = seatsRes.rows;

            res.status(200).json(room);
        } catch (error) {
            console.error("Lỗi chi tiết phòng:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 3. Thêm phòng chiếu mới tự động sinh hàng, cột và ghế vào bảng Seats
    createRoom: async (req, res) => {
        const client = await pool.connect();
        try {
            const { name, rows_count = 8, cols_per_row = 10, status = 'Hoạt động' } = req.body;
            if (!name || name.trim().length === 0) {
                return res.status(400).json({ message: "Tên phòng chiếu là bắt buộc" });
            }

            const totalRows = Math.min(Math.max(parseInt(rows_count) || 8, 1), 26);
            const totalCols = Math.min(Math.max(parseInt(cols_per_row) || 10, 1), 30);
            const capacity = totalRows * totalCols;

            await client.query('BEGIN');

            const roomRes = await client.query(
                'INSERT INTO Rooms (name, capacity, status) VALUES ($1, $2, $3) RETURNING *',
                [name.trim(), capacity, status]
            );
            const newRoom = roomRes.rows[0];

            // Tự động sinh hàng ghế từ A, B, C... và cột 1..N
            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const seatValues = [];

            for (let r = 0; r < totalRows; r++) {
                const rowLetter = alphabet[r];
                for (let c = 1; c <= totalCols; c++) {
                    let type = 'Standard';
                    // Mặc định các hàng giữa là VIP, hàng cuối cùng là Couple
                    if (totalRows >= 4 && r >= Math.floor(totalRows / 3) && r < Math.floor(totalRows * 0.75)) {
                        type = 'VIP';
                    } else if (r === totalRows - 1 && totalRows >= 3) {
                        type = 'Couple';
                    }
                    seatValues.push(`(${newRoom.id}, '${rowLetter}', ${c}, '${type}')`);
                }
            }

            if (seatValues.length > 0) {
                await client.query(`
                    INSERT INTO Seats (room_id, row_letter, seat_number, type) 
                    VALUES ${seatValues.join(', ')}
                `);
            }

            await client.query('COMMIT');

            res.status(201).json({
                message: `Tạo phòng chiếu thành công! Đã tự động khởi tạo ${capacity} ghế (${totalRows} hàng × ${totalCols} cột).`,
                room: newRoom
            });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Lỗi tạo phòng:", error);
            res.status(500).json({ message: error.message || "Lỗi máy chủ nội bộ" });
        } finally {
            client.release();
        }
    },

    // 4. Cập nhật thông tin phòng (Tên phòng & Trạng thái Hoạt động / Bảo trì)
    updateRoom: async (req, res) => {
        try {
            const { id } = req.params;
            const { name, status } = req.body;

            const roomCheck = await pool.query('SELECT * FROM Rooms WHERE id = $1', [id]);
            if (roomCheck.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy phòng chiếu" });
            }

            const updateRes = await pool.query(
                `UPDATE Rooms 
                 SET name = COALESCE($1, name),
                     status = COALESCE($2, status)
                 WHERE id = $3 RETURNING *`,
                [name ? name.trim() : null, status, id]
            );

            res.status(200).json({
                message: "Cập nhật phòng chiếu thành công!",
                room: updateRes.rows[0]
            });
        } catch (error) {
            console.error("Lỗi cập nhật phòng:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 5. Cập nhật cấu hình loại ghế (Standard, VIP, Couple) xuống bảng Seats
    updateSeatTypes: async (req, res) => {
        const client = await pool.connect();
        try {
            const { id } = req.params;
            const { seats } = req.body; // Danh sách [{ id, type }, ...]

            if (!Array.isArray(seats) || seats.length === 0) {
                return res.status(400).json({ message: "Danh sách ghế cần cập nhật không hợp lệ" });
            }

            await client.query('BEGIN');

            for (const s of seats) {
                if (['Standard', 'VIP', 'Couple'].includes(s.type)) {
                    await client.query(
                        'UPDATE Seats SET type = $1 WHERE id = $2 AND room_id = $3',
                        [s.type, s.id, id]
                    );
                }
            }

            await client.query('COMMIT');

            res.status(200).json({
                message: `Đã lưu cấu hình sơ đồ ghế (${seats.length} ghế) thành công!`
            });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Lỗi lưu sơ đồ ghế:", error);
            res.status(500).json({ message: "Lỗi lưu cấu hình sơ đồ ghế" });
        } finally {
            client.release();
        }
    },

    // 6. Xóa phòng chiếu (Chặn nếu phòng đã từng có suất chiếu)
    deleteRoom: async (req, res) => {
        try {
            const { id } = req.params;

            const stCheck = await pool.query('SELECT COUNT(*) FROM Showtimes WHERE room_id = $1', [id]);
            const stCount = parseInt(stCheck.rows[0].count);

            if (stCount > 0) {
                return res.status(400).json({
                    message: `Không thể xóa phòng chiếu này vì đã có ${stCount} suất chiếu liên kết! Vui lòng chuyển trạng thái sang "Bảo trì" thay vì xóa.`
                });
            }

            // Xóa ghế trước rồi xóa phòng
            await pool.query('DELETE FROM Seats WHERE room_id = $1', [id]);
            const deleteRes = await pool.query('DELETE FROM Rooms WHERE id = $1 RETURNING *', [id]);

            if (deleteRes.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy phòng để xóa" });
            }

            res.status(200).json({
                message: `Đã xóa phòng chiếu "${deleteRes.rows[0].name}" thành công!`
            });
        } catch (error) {
            console.error("Lỗi xóa phòng:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    }
};

module.exports = roomController;
