const express = require('express');
const router = express.Router();
const movieController = require('../controllers/movieController');
const authMiddleware = require('../middlewares/authMiddleware');

// Chỉ Admin mới có quyền kéo phim từ TMDB về
router.post('/fetch-tmdb', authMiddleware.verifyToken, authMiddleware.verifyAdmin, movieController.fetchFromTMDB);

module.exports = router;