const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Import 2 module của Node.js để chạy Socket.IO
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json()); 

// Khởi động các cơ sở dữ liệu
require('./config/db');
require('./config/redis'); // Gọi Redis

// Khai báo các Router
const authRoutes = require('./routes/authRoutes');
const movieRoutes = require('./routes/movieRoutes');
const showtimeRoutes = require('./routes/showtimeRoutes');
const ticketRoutes = require('./routes/ticketRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/movies', movieRoutes);
app.use('/api/showtimes', showtimeRoutes);
app.use('/api/tickets', ticketRoutes);

app.get('/', (req, res) => {
    res.send('Kết nối thành công Backend!');
});

// Bọc Express app bằng HTTP Server
const server = http.createServer(app);

// Khởi tạo máy chủ Socket.IO, cấu hình CORS cho phép Vue.js truy cập
const io = new Server(server, {
    cors: {
        origin: "*", // Tạm thời cho phép mọi nguồn, khi đưa lên mạng sẽ giới hạn lại
        methods: ["GET", "POST"]
    }
});

// Lắng nghe các kết nối từ trình duyệt khách hàng
io.on('connection', (socket) => {
    console.log(`📡 Một khách hàng vừa kết nối Real-time (ID: ${socket.id})`);
    
    // Khi khách hàng tắt trình duyệt
    socket.on('disconnect', () => {
        console.log(`🔌 Khách hàng đã ngắt kết nối (ID: ${socket.id})`);
    });
});

// TRUYỀN IO VÀO BIẾN GLOBAL ĐỂ CÁC CONTROLLER CÓ THỂ DÙNG ĐƯỢC ĐỂ PHÁT SÓNG
app.set('socketio', io);

// LƯU Ý SỰ THAY ĐỔI: Dùng server.listen thay vì app.listen
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server thời gian thực đang chạy tại http://localhost:${PORT}`);
});