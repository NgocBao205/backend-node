const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const authController = {
    // 1. API Đăng ký tài khoản (hỗ trợ date_of_birth, avatar_url, phone)
    register: async (req, res) => {
        try {
            const { full_name, email, password, phone, date_of_birth, avatar_url } = req.body;

            if (!full_name || !email || !password) {
                return res.status(400).json({ message: "Vui lòng điền họ tên, email và mật khẩu!" });
            }

            // Kiểm tra xem email đã tồn tại trong CSDL chưa
            const checkUser = await pool.query('SELECT id FROM Users WHERE email = $1', [email]);
            if (checkUser.rows.length > 0) {
                return res.status(400).json({ message: "Email này đã được sử dụng!" });
            }

            // Băm mật khẩu
            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(password, salt);

            // Lưu người dùng mới vào CSDL với các trường mở rộng
            const newUser = await pool.query(
                `INSERT INTO Users (full_name, email, password_hash, phone, date_of_birth, avatar_url, loyalty_points, role, status) 
                 VALUES ($1, $2, $3, $4, $5, $6, 0, 'Customer', 'Active') 
                 RETURNING id, full_name, email, phone, date_of_birth, avatar_url, loyalty_points, role`,
                [
                    full_name, 
                    email, 
                    password_hash, 
                    phone || null, 
                    date_of_birth || null, 
                    avatar_url || null
                ]
            );

            res.status(201).json({ 
                message: "Đăng ký tài khoản thành công!",
                user: newUser.rows[0]
            });
        } catch (error) {
            console.error("Lỗi đăng ký:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 2. API Đăng nhập (tự động cập nhật last_login)
    login: async (req, res) => {
        try {
            const { email, password } = req.body;

            const user = await pool.query('SELECT * FROM Users WHERE email = $1', [email]);
            if (user.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy tài khoản!" });
            }

            const currentUser = user.rows[0];

            if (currentUser.status === 'Banned') {
                return res.status(403).json({ message: "Tài khoản của bạn đã bị khóa!" });
            }

            const validPassword = await bcrypt.compare(password, currentUser.password_hash);
            if (!validPassword) {
                return res.status(400).json({ message: "Mật khẩu không chính xác!" });
            }

            // Cập nhật mốc thời gian last_login
            await pool.query('UPDATE Users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [currentUser.id]);

            // Tạo Token thông hành (JWT) 1 ngày
            const token = jwt.sign(
                { id: currentUser.id, role: currentUser.role }, 
                process.env.JWT_SECRET, 
                { expiresIn: '1d' }
            );

            res.status(200).json({
                message: "Đăng nhập thành công!",
                token: token,
                user: {
                    id: currentUser.id,
                    full_name: currentUser.full_name,
                    email: currentUser.email,
                    phone: currentUser.phone,
                    date_of_birth: currentUser.date_of_birth,
                    avatar_url: currentUser.avatar_url,
                    loyalty_points: currentUser.loyalty_points,
                    role: currentUser.role
                }
            });
        } catch (error) {
            console.error("Lỗi đăng nhập:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    }
};

module.exports = authController;
