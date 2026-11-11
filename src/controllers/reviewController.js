const pool = require('../config/db');
const axios = require('axios'); // Dùng axios để Node.js đi gọi API của Python

const reviewController = {
    createReview: async (req, res) => {
        try {
            const { movie_id, content, rating } = req.body;
            const user_id = req.user.id; // Lấy từ Token người dùng

            if (!movie_id || !content || !rating) {
                return res.status(400).json({ message: "Vui lòng nhập đủ đánh giá, nội dung và ID phim!" });
            }

            // 1. GIAO TIẾP MICROSERVICE: Hỏi máy chủ Python xem có Spoil không
            let is_spoiler = false;
            try {
                // Gọi sang cổng 8000 của AI Microservice
                const aiResponse = await axios.post('http://localhost:8000/api/ai/check-spoiler', {
                    content: content
                });
                is_spoiler = aiResponse.data.is_spoiler;
            } catch (aiError) {
                console.error("⚠️ Máy chủ AI Python đang bận hoặc sập. Cho phép đăng bình luận bỏ qua kiểm duyệt.");
                // Kỹ thuật Fallback: Nếu AI chết, ta vẫn cho khách đăng bình luận chứ không làm sập cả hệ thống rạp phim.
            }

            // 2. LƯU VÀO CƠ SỞ DỮ LIỆU POSTGRESQL
            const newReview = await pool.query(
                `INSERT INTO Reviews (user_id, movie_id, rating, content, is_spoiler) 
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [user_id, movie_id, rating, content, is_spoiler]
            );

            // 3. TRẢ KẾT QUẢ CHO FRONTEND
            res.status(201).json({
                message: is_spoiler 
                    ? "Bình luận của bạn đã được đăng nhưng bị che lại vì chứa nội dung tiết lộ phim (Spoiler)!" 
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