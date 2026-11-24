const express = require('express');
const router = express.Router();
const movieController = require('../controllers/movieController');
const authMiddleware = require('../middlewares/authMiddleware');
const { autoSyncStatus } = require('../middlewares/autoSyncMiddleware');

// Áp dụng autoSyncStatus cho tất cả các truy vấn xem danh sách / chi tiết phim
router.use(autoSyncStatus);

// 1. Lấy danh sách phim (kèm search & filter & pagination & avg_rating)
router.get('/', movieController.getAllMovies);

// 2. Tìm kiếm gợi ý nhanh từ TMDB theo từ khóa
router.get('/tmdb/search', authMiddleware.verifyAdmin, movieController.searchTMDB);

// 3. Lấy chi tiết một bộ phim
router.get('/:id', movieController.getMovieById);

// 4. Import phim từ TMDB (Chỉ Quản trị viên)
router.post('/fetch-tmdb', authMiddleware.verifyAdmin, movieController.fetchFromTMDB);
router.post('/import', authMiddleware.verifyAdmin, movieController.fetchFromTMDB);

// 5. Thêm phim thủ công (Chỉ Quản trị viên)
router.post('/', authMiddleware.verifyAdmin, movieController.createManualMovie);

// 6. Cập nhật trạng thái phim (Chỉ Quản trị viên)
router.patch('/:id/status', authMiddleware.verifyAdmin, movieController.updateStatus);

// 7. Cập nhật thông tin chi tiết phim (Chỉ Quản trị viên)
router.put('/:id', authMiddleware.verifyAdmin, movieController.updateMovie);

// 8. Xóa phim (Chỉ Quản trị viên, chặn xóa nếu đã có suất chiếu)
router.delete('/:id', authMiddleware.verifyAdmin, movieController.deleteMovie);

module.exports = router;
