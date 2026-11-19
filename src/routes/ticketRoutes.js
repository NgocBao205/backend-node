const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const authMiddleware = require('../middlewares/authMiddleware');

// 1. Giữ ghế (Auth)
router.post('/lock-seat', authMiddleware.verifyToken, ticketController.lockSeat);

// 2. Nhả ghế (Auth)
router.post('/unlock-seat', authMiddleware.verifyToken, ticketController.unlockSeat);

// 3. Xem danh sách vé đã mua của tôi (Auth)
router.get('/my-tickets', authMiddleware.verifyToken, ticketController.getMyTickets);

// 4. Nhân viên bán vé tại quầy (Staff / Admin)
router.post('/staff-sell', authMiddleware.verifyStaff, ticketController.staffSellTicket);

// 5. Nhân viên xác nhận vé vào rạp (Staff / Admin)
router.patch('/:id/verify', authMiddleware.verifyStaff, ticketController.verifyTicketEntry);

module.exports = router;
