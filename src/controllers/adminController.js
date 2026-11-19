const pool = require('../config/db');

const adminController = {
    // 1. Thống kê toàn diện hệ thống
    getStats: async (req, res) => {
        try {
            const revenueRes = await pool.query(
                "SELECT COALESCE(SUM(total_price), 0) as total_revenue FROM Tickets WHERE status IN ('Đã thanh toán', 'Đã xác nhận vào rạp')"
            );
            const ticketsRes = await pool.query(
                "SELECT COUNT(*) as total_tickets FROM Tickets WHERE status IN ('Đã thanh toán', 'Đã xác nhận vào rạp')"
            );
            const moviesRes = await pool.query(
                "SELECT COUNT(*) as total_movies FROM Movies WHERE status = 'Đang chiếu'"
            );
            const usersRes = await pool.query(
                "SELECT COUNT(*) as total_users FROM Users"
            );

            res.status(200).json({
                total_revenue: parseFloat(revenueRes.rows[0].total_revenue),
                total_tickets: parseInt(ticketsRes.rows[0].total_tickets),
                total_movies: parseInt(moviesRes.rows[0].total_movies),
                total_users: parseInt(usersRes.rows[0].total_users)
            });
        } catch (error) {
            console.error("Lỗi thống kê admin:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 2. Danh sách người dùng
    getAllUsers: async (req, res) => {
        try {
            const result = await pool.query(
                'SELECT id, full_name, email, phone, role, status FROM Users ORDER BY id DESC'
            );
            res.status(200).json(result.rows);
        } catch (error) {
            console.error("Lỗi lấy danh sách users:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 3. Đổi trạng thái User (Active / Banned)
    updateUserStatus: async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;

            const result = await pool.query(
                'UPDATE Users SET status = $1 WHERE id = $2 RETURNING id, full_name, email, role, status',
                [status, id]
            );

            if (result.rows.length === 0) return res.status(404).json({ message: "Không tìm thấy user" });

            res.status(200).json({ message: "Cập nhật trạng thái thành công!", user: result.rows[0] });
        } catch (error) {
            console.error("Lỗi đổi trạng thái user:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    }
};

module.exports = adminController;
