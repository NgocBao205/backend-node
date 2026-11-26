const pool = require('../config/db');

const favoriteController = {
    // 1. Lấy danh sách ID các phim người dùng đã thích (trả về array các movie_id)
    getUserFavorites: async (req, res) => {
        try {
            const userId = req.user.id;
            const result = await pool.query(
                `SELECT 
                    f.movie_id,
                    f.added_at,
                    m.title,
                    m.poster_url,
                    m.duration,
                    m.age_rating,
                    m.vote_average,
                    m.status
                 FROM Favorite_Movies f
                 JOIN Movies m ON f.movie_id = m.id
                 WHERE f.user_id = $1
                 ORDER BY f.added_at DESC`,
                [userId]
            );
            res.status(200).json({
                success: true,
                data: result.rows
            });
        } catch (error) {
            console.error("Lỗi lấy danh sách phim yêu thích:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 2. Thả tim hoặc Bỏ tim một bộ phim (Toggle)
    toggleFavorite: async (req, res) => {
        try {
            const userId = req.user.id;
            const { movieId } = req.params;

            const check = await (pool.queryWithRetry || pool.query.bind(pool))(
                'SELECT 1 FROM Favorite_Movies WHERE user_id = $1 AND movie_id = $2',
                [userId, movieId]
            );

            if (check.rows.length > 0) {
                // Đã thích -> Bỏ thích
                await (pool.queryWithRetry || pool.query.bind(pool))(
                    'DELETE FROM Favorite_Movies WHERE user_id = $1 AND movie_id = $2',
                    [userId, movieId]
                );
                return res.status(200).json({
                    is_favorite: false,
                    message: "Đã xóa phim khỏi danh sách yêu thích!"
                });
            } else {
                // Chưa thích -> Thêm vào yêu thích
                await (pool.queryWithRetry || pool.query.bind(pool))(
                    'INSERT INTO Favorite_Movies (user_id, movie_id) VALUES ($1, $2)',
                    [userId, movieId]
                );
                return res.status(200).json({
                    is_favorite: true,
                    message: "Đã thêm phim vào danh sách yêu thích!"
                });
            }
        } catch (error) {
            console.error("Lỗi toggle yêu thích phim:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    }
};

module.exports = favoriteController;
