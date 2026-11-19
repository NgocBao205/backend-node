const express = require('express');
const router = express.Router();
const movieController = require('../controllers/movieController');
const authMiddleware = require('../middlewares/authMiddleware');

router.get('/', movieController.getAllMovies);
router.post('/fetch-tmdb', authMiddleware.verifyToken, authMiddleware.verifyAdmin, movieController.fetchFromTMDB);

module.exports = router;