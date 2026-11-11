const { Redis } = require('@upstash/redis');
require('dotenv').config();

// Khởi tạo kết nối đến Upstash Redis Server
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Chạy thử một lệnh ping để kiểm tra kết nối
redis.ping().then(result => {
    console.log('Đã kết nối thành công đến Upstash Redis Cache!');
}).catch(err => {
    console.error('Lỗi kết nối Redis:', err);
});

module.exports = redis;