const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Khởi tạo ứng dụng Express
const app = express();

// Cấu hình Middleware cơ bản
app.use(cors()); // Cho phép Frontend ở port khác gọi API mà không bị lỗi CORS
app.use(express.json()); // Phân tích các request gửi lên dưới dạng JSON

// Import file kết nối DB để nó tự động chạy và kiểm tra
require('./config/db');

// Nhúng các Router
const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes); // Tất cả API đăng nhập/đăng ký sẽ bắt đầu bằng /api/auth

const movieRoutes = require('./routes/movieRoutes');
app.use('/api/movies', movieRoutes);

app.get('/', (req, res) => {
    res.send('Kết nối thành công Backend!');
});

// Mở cổng lắng nghe
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
});