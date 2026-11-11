const pool = require('../config/db'); // Gọi hồ bơi kết nối CSDL
const bcrypt = require('bcrypt'); // Thư viện mã hóa
const jwt = require('jsonwebtoken');

const authController = {
    // 1. API Đăng ký tài khoản
    register: async (req, res) => {
        try {
            // Rút trích dữ liệu từ Frontend gửi lên
            const { full_name, email, password, phone } = req.body;

            // Kiểm tra xem email đã tồn tại trong CSDL chưa
            const checkUser = await pool.query('SELECT * FROM Users WHERE email = $1', [email]);
            if (checkUser.rows.length > 0) {
                return res.status(400).json({ message: "Email này đã được sử dụng!" });
            }

            // Băm mật khẩu (Tạo ra một chuỗi loằng ngoằng không thể dịch ngược)
            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(password, salt);

            // Lưu người dùng mới vào DB (Mặc định role là Customer, status là Active)
            const newUser = await pool.query(
                `INSERT INTO Users (full_name, email, password_hash, phone, role, status) 
                 VALUES ($1, $2, $3, $4, 'Customer', 'Active') RETURNING id, full_name, email, role`,
                [full_name, email, password_hash, phone]
            );

            res.status(201).json({ 
                message: "Đăng ký tài khoản thành công!",
                user: newUser.rows[0]
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 2. API Đăng nhập
    login: async (req, res) => {
        try {
            const { email, password } = req.body;

            // Tìm người dùng theo email
            const user = await pool.query('SELECT * FROM Users WHERE email = $1', [email]);
            if (user.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy tài khoản!" });
            }

            const currentUser = user.rows[0];

            // Kiểm tra trạng thái tài khoản
            if (currentUser.status === 'Banned') {
                return res.status(403).json({ message: "Tài khoản của bạn đã bị khóa!" });
            }

            // So sánh mật khẩu khách nhập với mật khẩu đã băm trong DB
            const validPassword = await bcrypt.compare(password, currentUser.password_hash);
            if (!validPassword) {
                return res.status(400).json({ message: "Mật khẩu không chính xác!" });
            }

            // Tạo Token thông hành (JWT) có thời hạn 1 ngày
            const token = jwt.sign(
                { id: currentUser.id, role: currentUser.role }, 
                process.env.JWT_SECRET, 
                { expiresIn: '1d' }
            );

            // Trả về token và thông tin user cho Frontend
            res.status(200).json({
                message: "Đăng nhập thành công!",
                token: token,
                user: {
                    id: currentUser.id,
                    full_name: currentUser.full_name,
                    email: currentUser.email,
                    role: currentUser.role
                }
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    }
};

module.exports = authController;