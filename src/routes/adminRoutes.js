const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middlewares/authMiddleware');
const { autoSyncStatus } = require('../middlewares/autoSyncMiddleware');

router.use(authMiddleware.verifyAdmin);
router.use(autoSyncStatus);

router.get('/stats', adminController.getStats);
router.get('/health', adminController.getHealthStatus);

// Quản lý người dùng
router.get('/users', adminController.getAllUsers);
router.get('/users/:id', adminController.getUserDetail);
router.patch('/users/:id/status', adminController.updateUserStatus);
router.patch('/users/:id/role', adminController.updateUserRole);

// Quản lý vé
router.get('/tickets', adminController.getAllTickets);

module.exports = router;
