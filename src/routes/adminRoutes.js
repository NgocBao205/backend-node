const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middlewares/authMiddleware');

router.use(authMiddleware.verifyAdmin);

router.get('/stats', adminController.getStats);
router.get('/health', adminController.getHealthStatus);
router.get('/users', adminController.getAllUsers);
router.patch('/users/:id/status', adminController.updateUserStatus);
router.get('/tickets', adminController.getAllTickets);

module.exports = router;
