const jwt = require('jsonwebtoken');

const authMiddleware = {
    // Kiểm tra Token
    verifyToken: (req, res, next) => {
        // Lấy token từ Header của request
        const authHeader = req.header('Authorization');
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ message: "Từ chối truy cập! Yêu cầu phải có Token." });
        }

        try {
            // Giải mã Token bằng Khóa bí mật
            const verified = jwt.verify(token, process.env.JWT_SECRET);
            
            // Nếu hợp lệ, nhét thông tin của user (id, role) vào biến req.user
            req.user = verified; 
            
            // Cho phép vào API tiếp theo
            next(); 
        } catch (error) {
            res.status(403).json({ message: "Token không hợp lệ hoặc đã hết hạn!" });
        }
    },

    // 2. Phân quyền Quản trị viên
    verifyAdmin: (req, res, next) => {
        // Đầu tiên, bắt buộc phải qua vòng kiểm tra vé
        authMiddleware.verifyToken(req, res, () => {
            // Sau khi giải mã vé, kiểm tra chức vụ
            if (req.user.role === 'Admin') {
                next(); // Đúng Admin thì cho qua
            } else {
                res.status(403).json({ message: "Truy cập bị từ chối! Yêu cầu quyền Quản trị viên." });
            }
        });
    }
};

module.exports = authMiddleware;