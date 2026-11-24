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

            // 5 Đơn đặt vé mới nhất
            const recentTicketsRes = await pool.query(`
                SELECT 
                    t.id, 
                    u.full_name as customer_name, 
                    u.email as customer_email,
                    m.title as movie_title, 
                    t.total_price, 
                    t.payment_method, 
                    t.status
                FROM Tickets t
                JOIN Users u ON t.user_id = u.id
                JOIN Showtimes s ON t.showtime_id = s.id
                JOIN Movies m ON s.movie_id = m.id
                ORDER BY t.id DESC
                LIMIT 5
            `);

            // 4 Suất chiếu sắp tới (Chỉ lấy từ hôm nay trở đi) kèm tỷ lệ lấp đầy ghế
            const nextShowtimesRes = await pool.query(`
                SELECT 
                    s.id, 
                    m.title as movie_title, 
                    r.name as room_name, 
                    r.capacity,
                    s.start_time,
                    COUNT(t.id) as booked_seats
                FROM Showtimes s
                JOIN Movies m ON s.movie_id = m.id
                JOIN Rooms r ON s.room_id = r.id
                LEFT JOIN Tickets t ON s.id = t.showtime_id AND t.status IN ('Đã thanh toán', 'Đã xác nhận vào rạp')
                WHERE s.start_time >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::timestamp - INTERVAL '15 minutes'
                  AND s.status != 'Hủy'
                GROUP BY s.id, m.title, r.name, r.capacity, s.start_time
                ORDER BY s.start_time ASC
                LIMIT 4
            `);

            res.status(200).json({
                kpi: {
                    totalRevenue: parseFloat(revenueRes.rows[0].total_revenue) || 0,
                    totalTickets: parseInt(ticketsRes.rows[0].total_tickets) || 0,
                    activeMovies: parseInt(moviesRes.rows[0].total_movies) || 0,
                    totalUsers: parseInt(usersRes.rows[0].total_users) || 0,
                },
                chart7Days: chart7DaysRes.rows,
                movieRevenue: movieRevenueRes.rows,
                recentTickets: recentTicketsRes.rows,
                nextShowtimes: nextShowtimesRes.rows
            });

        } catch (error) {
            console.error("Lỗi lấy dữ liệu Admin Dashboard:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 2. Health check thực tế các microservices
    getHealthStatus: async (req, res) => {
        const health = {
            database: { status: 'down', latency_ms: null, message: '' },
            redis: { status: 'down', latency_ms: null, message: '' },
            ai_service: { status: 'down', latency_ms: null, message: '' },
            socket_io: { status: 'down', connected_clients: 0, message: '' }
        };

        // Ping PostgreSQL Supabase
        try {
            const startDb = Date.now();
            await pool.query('SELECT 1');
            health.database = { 
                status: 'up', 
                latency_ms: Date.now() - startDb, 
                message: 'Supabase PostgreSQL trực tuyến' 
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

    // 3. Danh sách người dùng (Hỗ trợ tìm kiếm, lọc vai trò, lọc trạng thái, phân trang, đếm đơn đặt vé)
    getAllUsers: async (req, res) => {
        try {
            const { search, role, status, page = 1, limit = 10, all = 'false' } = req.query;

            let query = `
                SELECT 
                    u.id, 
                    u.full_name, 
                    u.email, 
                    u.phone, 
                    u.date_of_birth,
                    u.avatar_url,
                    COALESCE(u.loyalty_points, 0) as loyalty_points,
                    u.role, 
                    u.status,
                    u.last_login,
                    u.created_at,
                    COUNT(t.id) as ticket_count,
                    COALESCE(SUM(t.total_price), 0) as total_spent
                FROM Users u
                LEFT JOIN Tickets t ON u.id = t.user_id AND t.status IN ('Đã thanh toán', 'Đã xác nhận vào rạp')
            `;

            const conditions = [];
            const values = [];

            if (role) {
                values.push(role);
                conditions.push(`u.role = $${values.length}`);
            }

            if (status) {
                values.push(status);
                conditions.push(`u.status = $${values.length}`);
            }

            if (search) {
                values.push(`%${search}%`);
                conditions.push(`(u.full_name ILIKE $${values.length} OR u.email ILIKE $${values.length} OR u.phone ILIKE $${values.length})`);
            }

            if (conditions.length > 0) {
                query += ` WHERE ${conditions.join(' AND ')}`;
            }

            query += ` GROUP BY u.id ORDER BY u.id DESC`;

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
            console.error("Lỗi lấy danh sách users:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 4. Lấy chi tiết 1 người dùng kèm toàn bộ lịch sử vé đã đặt
    getUserDetail: async (req, res) => {
        try {
            const { id } = req.params;

            const userRes = await pool.query(`
                SELECT 
                    id, full_name, email, phone, date_of_birth, avatar_url, 
                    COALESCE(loyalty_points, 0) as loyalty_points, role, status, last_login, created_at 
                FROM Users WHERE id = $1
            `, [id]);

            if (userRes.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy người dùng" });
            }

            const ticketsRes = await pool.query(`
                SELECT 
                    t.id,
                    t.total_price,
                    t.payment_method,
                    t.status,
                    t.seat_id,
                    m.title as movie_title,
                    m.poster_url,
                    r.name as room_name,
                    s.start_time
                FROM Tickets t
                JOIN Showtimes s ON t.showtime_id = s.id
                JOIN Movies m ON s.movie_id = m.id
                JOIN Rooms r ON s.room_id = r.id
                WHERE t.user_id = $1
                ORDER BY t.id DESC
            `, [id]);

            const user = userRes.rows[0];
            user.tickets = ticketsRes.rows;

            res.status(200).json(user);
        } catch (error) {
            console.error("Lỗi lấy chi tiết user:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 5. Đổi trạng thái User (Active / Banned) - Chống tự khóa chính mình
    updateUserStatus: async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;
            const currentAdminId = req.user?.id;

            // Kiểm tra chống tự khóa chính mình
            if (parseInt(id) === parseInt(currentAdminId)) {
                return res.status(400).json({
                    message: "Bảo vệ an toàn: Bạn không thể tự khóa (Ban) tài khoản của chính mình!"
                });
            }

            if (!['Active', 'Banned'].includes(status)) {
                return res.status(400).json({ message: "Trạng thái không hợp lệ (Active hoặc Banned)" });
            }

            const result = await pool.query(
                'UPDATE Users SET status = $1 WHERE id = $2 RETURNING id, full_name, email, role, status',
                [status, id]
            );

            if (result.rows.length === 0) return res.status(404).json({ message: "Không tìm thấy user" });

            res.status(200).json({ 
                message: `Đã ${status === 'Active' ? 'kích hoạt lại' : 'khóa (Ban)'} tài khoản thành công!`, 
                user: result.rows[0] 
            });
        } catch (error) {
            console.error("Lỗi đổi trạng thái user:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 6. Đổi vai trò / phân quyền User (Customer / Staff / Admin) - Chống tự hạ quyền chính mình
    updateUserRole: async (req, res) => {
        try {
            const { id } = req.params;
            const { role } = req.body;
            const currentAdminId = req.user?.id;

            if (!['Customer', 'Staff', 'Admin'].includes(role)) {
                return res.status(400).json({ message: "Vai trò không hợp lệ (Customer, Staff, hoặc Admin)" });
            }

            // Chống tự hạ quyền Admin của chính mình
            if (parseInt(id) === parseInt(currentAdminId) && role !== 'Admin') {
                return res.status(400).json({
                    message: "Bảo vệ an toàn: Bạn không thể tự hạ quyền Admin của chính mình!"
                });
            }

            const result = await pool.query(
                'UPDATE Users SET role = $1 WHERE id = $2 RETURNING id, full_name, email, role, status',
                [role, id]
            );

            if (result.rows.length === 0) return res.status(404).json({ message: "Không tìm thấy user" });

            res.status(200).json({ 
                message: `Đã phân quyền thành công tài khoản "${result.rows[0].full_name}" sang vai trò [${role}]!`, 
                user: result.rows[0] 
            });
        } catch (error) {
            console.error("Lỗi cập nhật vai trò user:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 7. Danh sách toàn bộ vé / đơn hàng (cho Quản lý Vé)
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
