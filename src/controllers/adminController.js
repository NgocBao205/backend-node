const pool = require('../config/db');
const redis = require('../config/redis');
const axios = require('axios');

const adminController = {
    // 1. Thống kê toàn diện hệ thống + Dữ liệu biểu đồ + Đơn hàng gần nhất + Suất chiếu từ hôm nay trở đi
    getStats: async (req, res) => {
        try {
            // KPI Cards
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

            // 7 Ngày qua (Lấy ngày thực tế từ Database)
            const chart7DaysRes = await pool.query(`
                SELECT 
                    TO_CHAR(days.day, 'DD/MM') as date_label,
                    COALESCE(SUM(t.total_price), 0) as revenue,
                    COUNT(t.id) as ticket_count
                FROM (
                    SELECT CURRENT_DATE - i AS day
                    FROM generate_series(6, 0, -1) AS i
                ) days
                LEFT JOIN Tickets t ON DATE(t.id::text) = days.day AND t.status IN ('Đã thanh toán', 'Đã xác nhận vào rạp')
                GROUP BY days.day
                ORDER BY days.day ASC
            `);

            // Tỷ lệ doanh thu theo phim đang chiếu
            const movieRevenueRes = await pool.query(`
                SELECT 
                    m.title,
                    COALESCE(SUM(t.total_price), 0) as revenue,
                    COUNT(t.id) as ticket_count
                FROM Movies m
                LEFT JOIN Showtimes s ON m.id = s.movie_id
                LEFT JOIN Tickets t ON s.id = t.showtime_id AND t.status IN ('Đã thanh toán', 'Đã xác nhận vào rạp')
                WHERE m.status = 'Đang chiếu'
                GROUP BY m.id, m.title
                ORDER BY revenue DESC
                LIMIT 5
            `);

            // 5 Đơn đặt vé gần nhất
            const recentTicketsRes = await pool.query(`
                SELECT 
                    t.id,
                    t.total_price,
                    t.payment_method,
                    t.status,
                    u.full_name as customer_name,
                    u.email as customer_email,
                    m.title as movie_title,
                    r.name as room_name,
                    t.seat_id
                FROM Tickets t
                JOIN Users u ON t.user_id = u.id
                JOIN Showtimes s ON t.showtime_id = s.id
                JOIN Movies m ON s.movie_id = m.id
                JOIN Rooms r ON s.room_id = r.id
                ORDER BY t.id DESC
                LIMIT 5
            `);

            // Suất chiếu TỪ HÔM NAY TRỞ ĐI (lọc bỏ các suất cũ trong quá khứ), giới hạn 4 suất sắp tới
            const todayShowtimesRes = await pool.query(`
                SELECT 
                    s.id,
                    s.start_time,
                    s.end_time,
                    s.base_price,
                    s.status,
                    m.title as movie_title,
                    m.duration,
                    r.name as room_name,
                    r.capacity,
                    COUNT(t.id) as booked_seats
                FROM Showtimes s
                JOIN Movies m ON s.movie_id = m.id
                JOIN Rooms r ON s.room_id = r.id
                LEFT JOIN Tickets t ON s.id = t.showtime_id AND t.status IN ('Đã thanh toán', 'Đã xác nhận vào rạp')
                WHERE s.status != 'Hủy' AND s.start_time >= CURRENT_DATE
                GROUP BY s.id, m.title, m.duration, r.name, r.capacity
                ORDER BY s.start_time ASC
                LIMIT 4
            `);

            res.status(200).json({
                total_revenue: parseFloat(revenueRes.rows[0].total_revenue),
                total_tickets: parseInt(ticketsRes.rows[0].total_tickets),
                total_movies: parseInt(moviesRes.rows[0].total_movies),
                total_users: parseInt(usersRes.rows[0].total_users),
                chart_7_days: chart7DaysRes.rows,
                movie_revenue: movieRevenueRes.rows,
                recent_tickets: recentTicketsRes.rows,
                today_showtimes: todayShowtimesRes.rows
            });
        } catch (error) {
            console.error("Lỗi thống kê admin:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 2. Health Check kiểm tra thực tế từng dịch vụ (DB, Redis, AI Microservice, Socket.IO)
    getHealthStatus: async (req, res) => {
        const health = {
            database: { status: 'down', message: 'Không thể kết nối' },
            redis: { status: 'down', message: 'Không thể kết nối' },
            ai_service: { status: 'down', message: 'Không thể kết nối' },
            socket_io: { status: 'up', message: 'Máy chủ Socket.IO đang lắng nghe' }
        };

        // Ping PostgreSQL
        try {
            const startDb = Date.now();
            await pool.query('SELECT 1');
            health.database = { 
                status: 'up', 
                latency_ms: Date.now() - startDb, 
                message: 'PostgreSQL (Supabase) phản hồi tốt' 
            };
        } catch (err) {
            health.database = { status: 'down', message: err.message };
        }

        // Ping Upstash Redis
        try {
            const startRedis = Date.now();
            const pong = await redis.ping();
            health.redis = { 
                status: 'up', 
                latency_ms: Date.now() - startRedis, 
                message: `Upstash Redis phản hồi: ${pong}` 
            };
        } catch (err) {
            health.redis = { status: 'down', message: err.message };
        }

        // Ping AI Microservice (FastAPI trên port 8000)
        try {
            const startAi = Date.now();
            const aiRes = await axios.get('http://localhost:8000/', { timeout: 2000 });
            health.ai_service = { 
                status: 'up', 
                latency_ms: Date.now() - startAi, 
                message: aiRes.data?.message || 'Python AI (Groq SDK) trực tuyến' 
            };
        } catch (err) {
            health.ai_service = { 
                status: 'down', 
                message: 'AI Service (port 8000) không phản hồi' 
            };
        }

        // Socket.IO status
        const io = req.app.get('socketio');
        if (io) {
            health.socket_io = { 
                status: 'up', 
                connected_clients: io.engine.clientsCount || 0,
                message: `Socket.IO hoạt động (${io.engine.clientsCount || 0} client kết nối)` 
            };
        } else {
            health.socket_io = { status: 'down', message: 'Socket.IO chưa khởi tạo' };
        }

        const allUp = health.database.status === 'up' && health.redis.status === 'up' && health.ai_service.status === 'up';

        res.status(200).json({
            overall: allUp ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            services: health
        });
    },

    // 3. Danh sách người dùng
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

    // 4. Đổi trạng thái User (Active / Banned)
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
    },

    // 5. Danh sách toàn bộ vé / đơn hàng (cho Quản lý Vé)
    getAllTickets: async (req, res) => {
        try {
            const result = await pool.query(`
                SELECT 
                    t.id,
                    t.total_price,
                    t.payment_method,
                    t.status,
                    t.seat_id,
                    u.full_name as customer_name,
                    u.email as customer_email,
                    u.phone as customer_phone,
                    m.title as movie_title,
                    m.poster_url,
                    r.name as room_name,
                    s.start_time
                FROM Tickets t
                JOIN Users u ON t.user_id = u.id
                JOIN Showtimes s ON t.showtime_id = s.id
                JOIN Movies m ON s.movie_id = m.id
                JOIN Rooms r ON s.room_id = r.id
                ORDER BY t.id DESC
            `);
            res.status(200).json(result.rows);
        } catch (error) {
            console.error("Lỗi lấy danh sách vé:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    }
};

module.exports = adminController;
