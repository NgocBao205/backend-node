const express = require('express');
const router = express.Router();
const favoriteController = require('../controllers/favoriteController');
const authMiddleware = require('../middlewares/authMiddleware');

router.use(authMiddleware.verifyToken);

router.get('/', favoriteController.getUserFavorites);
router.post('/toggle/:movieId', favoriteController.toggleFavorite);

module.exports = router;
