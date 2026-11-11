const pool = require('../config/db');
const axios = require('axios');

const chatController = {
    askChatbot: async (req, res) => {
        try {
            const { question } = req.body;
            if (!question) return res.status(400).json({ message: "Vui lòng nhập câu hỏi!" });

            // 1. MÓC DỮ LIỆU TỪ CSDL ĐỂ LÀM "TÀI LIỆU" CHO AI ĐỌC
            // Chúng ta lấy danh sách phim đang chiếu và giá vé cơ bản
            const movieRes = await pool.query(`SELECT title, duration FROM Movies WHERE status = 'Sắp chiếu' OR status = 'Đang chiếu'`);
            
            let context_data = "Danh sách phim đang chiếu: \n";
            movieRes.rows.forEach(m => {
                context_data += `- Phim ${m.title}, thời lượng ${m.duration} phút. Giá vé cơ bản: 75,000 VNĐ.\n`;
            });
            context_data += "Giờ mở cửa rạp: 8h00 sáng đến 23h00 đêm.";

            // 2. GỬI CÂU HỎI VÀ DỮ LIỆU SANG PYTHON
            const aiResponse = await axios.post('http://localhost:8000/api/ai/chat', {
                question: question,
                context_data: context_data
            });

            // 3. TRẢ CÂU TRẢ LỜI CHO FRONTEND
            res.status(200).json({
                message: "Thành công",
                answer: aiResponse.data.answer
            });

        } catch (error) {
            console.error("Lỗi Chatbot:", error);
            res.status(500).json({ message: "Chatbot hiện đang bận, vui lòng thử lại sau." });
        }
    }
};

module.exports = chatController;