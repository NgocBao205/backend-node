const pool = require('../config/db');
const axios = require('axios');

const reviewController = {
    // 1. Lấy danh sách bình luận cho một bộ phim
    getReviewsByMovie: async (req, res) => {
        try {
            const { movieId } = req.params;
            const result = await pool.query(
                `SELECT r.id, r.movie_id, r.rating, r.content, r.is_spoiler, r.created_at,
                        u.full_name as user_name
                 FROM Reviews r
                 JOIN Users u ON r.user_id = u.id
                 WHERE r.movie_id = $1
                 ORDER BY r.created_at DESC`,
                [movieId]
            );
            res.status(200).json(result.rows);
        } catch (error) {
            console.error("Lỗi lấy danh sách bình luận:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 2. Viết bình luận có kiểm duyệt Spoiler qua AI Microservice
    createReview: async (req, res) => {
        try {
            const { movie_id, content, rating } = req.body;
            const user_id = req.user.id;

            if (!movie_id || !content || !rating) {
                return res.status(400).json({ message: "Vui lòng nhập đủ đánh giá, nội dung và ID phim!" });
            }

            let is_spoiler = false;
            try {
                const aiResponse = await axios.post('http://localhost:8000/api/ai/check-spoiler', {
                    content: content
                });
                is_spoiler = aiResponse.data.is_spoiler;
            } catch (aiError) {
                console.error("⚠️ Máy chủ AI Python đang bận. Fallback: Cho phép đăng bình luận.");
            }

            const newReview = await pool.query(
                `INSERT INTO Reviews (user_id, movie_id, rating, content, is_spoiler) 
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [user_id, movie_id, rating, content, is_spoiler]
            );

            res.status(201).json({
                message: is_spoiler 
                    ? "Bình luận của bạn đã được đăng nhưng bị làm mờ vì chứa nội dung tiết lộ phim (Spoiler)!" 
                    : "Đăng bình luận thành công!",
                review: newReview.rows[0]
            });

        } catch (error) {
            console.error("Lỗi tạo bình luận:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    }
};

module.exports = reviewController;
