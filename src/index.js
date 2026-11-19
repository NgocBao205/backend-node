const express = require('express');
const cors = require('cors');
require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json()); 

// Khởi động các cơ sở dữ liệu
require('./config/db');
require('./config/redis');

// Khai báo các Router
const authRoutes = require('./routes/authRoutes');
const movieRoutes = require('./routes/movieRoutes');
const showtimeRoutes = require('./routes/showtimeRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const chatRoutes = require('./routes/chatRoutes');
const roomRoutes = require('./routes/roomRoutes');
const adminRoutes = require('./routes/adminRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/movies', movieRoutes);
app.use('/api/showtimes', showtimeRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/admin', adminRoutes);

app.get('/', (req, res) => {
    res.send('Kết nối thành công Backend CINEVIE API Full Stack!');
});

// Bọc Express app bằng HTTP Server
const server = http.createServer(app);

// Khởi tạo máy chủ Socket.IO
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Lắng nghe các kết nối từ client
io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client kết nối: ${socket.id}`);

    // Join room theo showtime
    socket.on('join_showtime', (showtimeId) => {
        socket.join(`showtime_${showtimeId}`);
        console.log(`[Socket.IO] Client ${socket.id} join showtime_${showtimeId}`);
    });

    // Client gửi yêu cầu lock ghế
    socket.on('lockSeat', (seatId) => {
        socket.broadcast.emit('seat_locked', { seat_id: seatId });
        socket.broadcast.emit('seatLocked', seatId);
    });

    // Client nhả ghế
    socket.on('unlockSeat', (seatId) => {
        socket.broadcast.emit('seat_unlocked', { seat_id: seatId });
    });

    socket.on('disconnect', () => {
        console.log(`[Socket.IO] Client ngắt kết nối: ${socket.id}`);
    });
});

app.set('socketio', io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Backend CINEVIE đang chạy tại http://localhost:${PORT}`);
});
