const express = require('express');
const router = express.Router();
const movieController = require('../controllers/movieController');
const authMiddleware = require('../middlewares/authMiddleware');

// 1. Lấy danh sách phim (kèm search & filter)
router.get('/', movieController.getAllMovies);

// 2. Lấy chi tiết một bộ phim
router.get('/:id', movieController.getMovieById);

// 3. Import phim từ TMDB (Chỉ Quản trị viên)
router.post('/fetch-tmdb', authMiddleware.verifyAdmin, movieController.fetchFromTMDB);

// 4. Cập nhật trạng thái phim (Chỉ Quản trị viên)
router.patch('/:id/status', authMiddleware.verifyAdmin, movieController.updateStatus);

module.exports = router;
