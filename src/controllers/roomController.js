const pool = require('../config/db');

const roomController = {
    // 1. Lấy danh sách tất cả phòng chiếu
    getAllRooms: async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM Rooms ORDER BY id ASC');
            res.status(200).json(result.rows);
        } catch (error) {
            console.error("Lỗi lấy danh sách phòng:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 2. Lấy chi tiết phòng chiếu và danh sách ghế
    getRoomById: async (req, res) => {
        try {
            const { id } = req.params;
            const roomRes = await pool.query('SELECT * FROM Rooms WHERE id = $1', [id]);

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

    // 3. Thêm phòng chiếu mới
    createRoom: async (req, res) => {
        try {
            const { name, capacity, status } = req.body;
            if (!name) return res.status(400).json({ message: "Tên phòng chiếu là bắt buộc" });

            const result = await pool.query(
                'INSERT INTO Rooms (name, capacity, status) VALUES ($1, $2, $3) RETURNING *',
                [name, capacity || 40, status || 'Hoạt động']
            );

            res.status(201).json({
                message: "Tạo phòng chiếu mới thành công!",
                room: result.rows[0]
            });
        } catch (error) {
            console.error("Lỗi tạo phòng:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    }
};

module.exports = roomController;
