const { Pool } = require('pg');
require('dotenv').config(); // Tải các biến từ file .env

// Khởi tạo một Connection Pool (10-20 users)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Bắt buộc phải có khi kết nối đến Cloud Database Subapase
    }
});

// Chạy kiểm tra kết nối ngay khi khởi động
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Lỗi kết nối CSDL:', err.stack);
    }
    console.log('Đã kết nối thành công đến PostgreSQL!');
    release(); // Trả kết nối lại cho Pool sau khi test xong
});

// Xuất pool ra để các file khác có thể lấy dùng để query SQL
module.exports = pool;