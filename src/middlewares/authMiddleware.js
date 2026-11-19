const jwt = require('jsonwebtoken');

const authMiddleware = {
    // 1. Kiểm tra Token
    verifyToken: (req, res, next) => {
        const authHeader = req.header('Authorization');
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ message: "Từ chối truy cập! Yêu cầu phải có Token." });
        }

        try {
            const verified = jwt.verify(token, process.env.JWT_SECRET);
            req.user = verified; 
            next(); 
        } catch (error) {
            res.status(403).json({ message: "Token không hợp lệ hoặc đã hết hạn!" });
        }
    },

    // 2. Phân quyền Quản trị viên
    verifyAdmin: (req, res, next) => {
        authMiddleware.verifyToken(req, res, () => {
            if (req.user && req.user.role === 'Admin') {
                next();
            } else {
                res.status(403).json({ message: "Truy cập bị từ chối! Yêu cầu quyền Quản trị viên." });
            }
        });
    },

    // 3. Phân quyền Nhân viên & Admin
    verifyStaff: (req, res, next) => {
        authMiddleware.verifyToken(req, res, () => {
            if (req.user && (req.user.role === 'Staff' || req.user.role === 'Admin')) {
                next();
            } else {
                res.status(403).json({ message: "Truy cập bị từ chối! Dành riêng cho nhân viên hoặc quản trị viên." });
            }
        });
    }
};

module.exports = authMiddleware;
