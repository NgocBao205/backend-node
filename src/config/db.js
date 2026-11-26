const { Pool } = require('pg');
require('dotenv').config();

// Khởi tạo Connection Pool tối ưu cho Supabase Transaction Pooler (Cổng 6543)
// Lưu ý đối với Transaction Pooler: Các kết nối được Supabase thu hồi/tái cấp liên tục
// Cần để pool tự động tạo mới kết nối khi cần và đóng kết nối cũ nhanh chóng (max: 20, idleTimeoutMillis: 1000)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 2000, // Đóng kết nối idle sau 2s để tránh giữ stale socket bị Supabase đóng
    connectionTimeoutMillis: 5000,
    allowExitOnIdle: true
});

// Bắt lỗi rớt kết nối bất ngờ ở mức Pool để ngăn unhandled socket error
pool.on('error', (err, client) => {
    // Supabase Transaction Pooler ngắt kết nối idle là hành vi thông thường của PgBouncer
    if (err.code === 'ECONNRESET' || err.message.includes('ECONNRESET')) {
        return; // Bỏ qua log spam vì Pool sẽ tự động mở kết nối mới khi có query tiếp theo
    }
    console.error('Lỗi kết nối PostgreSQL Pool:', err.message);
});

// Helper thực thi query tự động thử lại 1 lần nếu gặp socket reset do stale connection
const queryWithRetry = async (text, params) => {
    try {
        return await pool.query(text, params);
    } catch (err) {
        if (err.code === 'ECONNRESET' || err.message.includes('ECONNRESET')) {
            return await pool.query(text, params);
        }
        throw err;
    }
};

// Kiểm tra kết nối ban đầu
pool.query('SELECT 1').then(() => {
    console.log('Đã kết nối thành công đến PostgreSQL (Supabase Pooler)!');
}).catch(err => {
    console.error('Lỗi kết nối CSDL ban đầu:', err.message);
});

pool.queryWithRetry = queryWithRetry;
module.exports = pool;