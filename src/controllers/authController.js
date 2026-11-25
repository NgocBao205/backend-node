const pool = require('../config/db');
const redis = require('../config/redis');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const authController = {
    // 1. API Đăng ký tài khoản (Bắt buộc phone & date_of_birth; kiểm tra kỹ lưỡng các trường)
    register: async (req, res) => {
        try {
            const { full_name, email, password, phone, date_of_birth, fax_number } = req.body;

            // Honeypot Bot Trap: Nếu có bot tự động điền trường ẩn fax_number thì lập tức từ chối âm thầm
            if (fax_number) {
                return res.status(400).json({ message: "Yêu cầu không hợp lệ!" });
            }

            // 1. Họ và tên
            if (!full_name || !full_name.trim() || full_name.trim().length < 2) {
                return res.status(400).json({ message: "Vui lòng nhập họ và tên hợp lệ (tối thiểu 2 ký tự)!" });
            }

            // 2. Email: định dạng chuẩn RFC và kiểm tra trùng
            if (!email || !email.trim()) {
                return res.status(400).json({ message: "Vui lòng nhập địa chỉ email!" });
            }
            const cleanEmail = email.trim().toLowerCase();
            const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
            if (!emailRegex.test(cleanEmail)) {
                return res.status(400).json({ message: "Địa chỉ email không đúng định dạng (Ví dụ: tenban@gmail.com)!" });
            }

            const checkEmail = await pool.query('SELECT id FROM Users WHERE email = $1', [cleanEmail]);
            if (checkEmail.rows.length > 0) {
                return res.status(400).json({ message: "Email này đã được sử dụng bởi một tài khoản khác!" });
            }

            // 3. Số điện thoại (Bắt buộc): Chuẩn 10 số đầu 0 (Việt Nam) và kiểm tra trùng
            if (!phone || !phone.trim()) {
                return res.status(400).json({ message: "Vui lòng nhập số điện thoại liên hệ (bắt buộc)!" });
            }
            const cleanPhone = phone.trim().replace(/\s+/g, '');
            const phoneRegex = /^(0|\+84)[3|5|7|8|9][0-9]{8}$/;
            if (!phoneRegex.test(cleanPhone)) {
                return res.status(400).json({ message: "Số điện thoại không hợp lệ (Bao gồm 10 chữ số, ví dụ: 0912345678)!" });
            }

            const checkPhone = await pool.query('SELECT id FROM Users WHERE phone = $1', [cleanPhone]);
            if (checkPhone.rows.length > 0) {
                return res.status(400).json({ message: "Số điện thoại này đã được sử dụng bởi một tài khoản khác!" });
            }

            // 4. Ngày sinh (Bắt buộc): Kiểm tra giới hạn tuổi hợp lý (Từ 6 tuổi đến 120 tuổi)
            if (!date_of_birth) {
                return res.status(400).json({ message: "Vui lòng chọn ngày sinh (bắt buộc)!" });
            }
            const birthDate = new Date(date_of_birth);
            if (isNaN(birthDate.getTime())) {
                return res.status(400).json({ message: "Ngày sinh không hợp lệ!" });
            }
            const today = new Date();
            let age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                age--;
            }
            if (birthDate > today) {
                return res.status(400).json({ message: "Ngày sinh không thể nằm trong tương lai!" });
            }
            if (age < 6) {
                return res.status(400).json({ message: "Người dùng phải từ đủ 6 tuổi trở lên để tạo tài khoản rạp phim!" });
            }
            if (age > 120) {
                return res.status(400).json({ message: "Ngày sinh không hợp lệ (vượt quá giới hạn cho phép)!" });
            }

            // 5. Mật khẩu: Tối thiểu 8 ký tự, bao gồm ít nhất 1 ký tự đặc biệt
            if (!password || password.length < 8) {
                return res.status(400).json({ message: "Mật khẩu phải chứa ít nhất 8 ký tự!" });
            }
            const specialCharRegex = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;
            if (!specialCharRegex.test(password)) {
                return res.status(400).json({ message: "Mật khẩu phải chứa ít nhất 1 ký tự đặc biệt (Ví dụ: @, #, $, %,...)!" });
            }

            // Băm mật khẩu
            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(password, salt);

            // Lưu người dùng mới vào CSDL
            const newUser = await pool.query(
                `INSERT INTO Users (full_name, email, password_hash, phone, date_of_birth, avatar_url, loyalty_points, role, status) 
                 VALUES ($1, $2, $3, $4, $5, NULL, 0, 'Customer', 'Active') 
                 RETURNING id, full_name, email, phone, date_of_birth, loyalty_points, role`,
                [
                    full_name.trim(), 
                    cleanEmail, 
                    password_hash, 
                    cleanPhone, 
                    date_of_birth
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

    // 2. API Đăng nhập (hỗ trợ phân vùng đăng nhập portal: 'client' hoặc 'admin')
    login: async (req, res) => {
        try {
            const { email, password, portal = 'client', fax_number } = req.body;

            // Honeypot Bot Trap:
            if (fax_number) {
                return res.status(400).json({ message: "Yêu cầu không hợp lệ!" });
            }

            if (!email || !password) {
                return res.status(400).json({ message: "Vui lòng nhập đầy đủ email và mật khẩu!" });
            }

            const cleanEmail = email.trim().toLowerCase();
            const userRes = await pool.query('SELECT * FROM Users WHERE email = $1', [cleanEmail]);
            if (userRes.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy tài khoản với email này!" });
            }

            const currentUser = userRes.rows[0];

            if (currentUser.status === 'Banned') {
                return res.status(403).json({ message: "Tài khoản của bạn đã bị khóa bởi Quản trị viên!" });
            }

            const validPassword = await bcrypt.compare(password, currentUser.password_hash);
            if (!validPassword) {
                return res.status(400).json({ message: "Mật khẩu không chính xác!" });
            }

            // --- PHÂN VÙNG ĐĂNG NHẬP CHẶT CHẼ ---
            if (portal === 'client') {
                if (currentUser.role === 'Admin') {
                    return res.status(403).json({
                        role: 'Admin',
                        message: "Đây là tài khoản Quản Trị Viên! Vui lòng truy cập Cổng Quản Trị Nội Bộ (/portal-qtv-99x) để đăng nhập."
                    });
                }
            }

            if (portal === 'admin') {
                if (currentUser.role !== 'Admin') {
                    return res.status(403).json({
                        message: "Truy cập bị từ chối: Cổng này chỉ dành riêng cho tài khoản Quản Trị Viên (Admin)!"
                    });
                }
            }

            // Cập nhật mốc thời gian last_login
            await pool.query('UPDATE Users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [currentUser.id]);

            // Tạo Token JWT 1 ngày
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
    },

    // 3. API Quên mật khẩu: Gửi mã OTP xác nhận
    forgotPassword: async (req, res) => {
        try {
            const { email } = req.body;
            if (!email) {
                return res.status(400).json({ message: "Vui lòng nhập địa chỉ email!" });
            }
            const cleanEmail = email.trim().toLowerCase();
            const userRes = await pool.query('SELECT id, full_name FROM Users WHERE email = $1', [cleanEmail]);
            if (userRes.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy tài khoản gắn với email này!" });
            }

            // Sinh mã OTP 6 số
            const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

            // Lưu vào Upstash Redis hoặc in-memory với thời gian 5 phút (300 giây)
            try {
                if (redis && redis.set) {
                    await redis.set(`reset_otp:${cleanEmail}`, otpCode, { ex: 300 });
                }
            } catch (redisErr) {
                console.warn("Lưu OTP vào Redis thất bại, fallback console:", redisErr.message);
            }

            // Log OTP ra console terminal cho môi trường dev/local để kiểm tra ngay
            console.log(`\n======================================================`);
            console.log(`[CINEVIE RESET PASSWORD OTP]`);
            console.log(`Email: ${cleanEmail}`);
            console.log(`Mã xác thực OTP (Hiệu lực 5 phút): ${otpCode}`);
            console.log(`======================================================\n`);

            res.status(200).json({
                message: "Mã xác thực OTP đã được gửi thành công! (Vui lòng kiểm tra email hoặc terminal máy chủ)",
                otp_dev_preview: otpCode // Trả về kèm cho môi trường đồ án tiện test
            });
        } catch (error) {
            console.error("Lỗi yêu cầu OTP quên mật khẩu:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 4. API Đặt lại mật khẩu mới (Xác thực qua OTP)
    resetPassword: async (req, res) => {
        try {
            const { email, otp, new_password } = req.body;

            if (!email || !otp || !new_password) {
                return res.status(400).json({ message: "Vui lòng nhập đầy đủ Email, Mã OTP và Mật khẩu mới!" });
            }

            const cleanEmail = email.trim().toLowerCase();

            // Lấy OTP từ Redis hoặc kiểm tra
            let storedOtp = null;
            try {
                if (redis && redis.get) {
                    storedOtp = await redis.get(`reset_otp:${cleanEmail}`);
                }
            } catch (redisErr) {
                console.warn("Lấy OTP từ Redis lỗi:", redisErr.message);
            }

            // Kiểm tra mã OTP
            if (storedOtp && storedOtp.toString() !== otp.toString().trim()) {
                return res.status(400).json({ message: "Mã OTP không chính xác hoặc đã hết hạn!" });
            }

            // Kiểm tra chuẩn mật khẩu mới
            if (new_password.length < 8) {
                return res.status(400).json({ message: "Mật khẩu mới phải chứa ít nhất 8 ký tự!" });
            }
            const specialCharRegex = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;
            if (!specialCharRegex.test(new_password)) {
                return res.status(400).json({ message: "Mật khẩu mới phải chứa ít nhất 1 ký tự đặc biệt (!, @, #, $, %,...)!" });
            }

            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(new_password, salt);

            await pool.query('UPDATE Users SET password_hash = $1 WHERE email = $2', [password_hash, cleanEmail]);

            // Xóa OTP sau khi đổi thành công
            try {
                if (redis && redis.del) {
                    await redis.del(`reset_otp:${cleanEmail}`);
                }
            } catch (e) {}

            res.status(200).json({
                message: "Đặt lại mật khẩu thành công! Bạn có thể đăng nhập bằng mật khẩu mới ngay bây giờ."
            });
        } catch (error) {
            console.error("Lỗi đặt lại mật khẩu:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 5. API Đăng nhập / Đăng ký nhanh qua Google OAuth
    googleAuth: async (req, res) => {
        try {
            const { email, full_name, avatar_url, google_id } = req.body;

            if (!email) {
                return res.status(400).json({ message: "Dữ liệu xác thực Google không có email!" });
            }

            const cleanEmail = email.trim().toLowerCase();
            let userQuery = await pool.query('SELECT * FROM Users WHERE email = $1', [cleanEmail]);

            let user;
            if (userQuery.rows.length === 0) {
                // Tạo tài khoản mới tự động từ Google Profile
                const randomPass = Math.random().toString(36).slice(-10) + '!@#';
                const salt = await bcrypt.genSalt(10);
                const password_hash = await bcrypt.hash(randomPass, salt);

                const insertRes = await pool.query(
                    `INSERT INTO Users (full_name, email, password_hash, avatar_url, role, status)
                     VALUES ($1, $2, $3, $4, 'Customer', 'Active')
                     RETURNING id, full_name, email, phone, date_of_birth, avatar_url, loyalty_points, role`,
                    [full_name || 'Khách hàng Google', cleanEmail, password_hash, avatar_url || null]
                );
                user = insertRes.rows[0];
            } else {
                user = userQuery.rows[0];
                if (user.status === 'Banned') {
                    return res.status(403).json({ message: "Tài khoản của bạn đã bị khóa!" });
                }
                // Cập nhật avatar nếu trước đó chưa có
                if (!user.avatar_url && avatar_url) {
                    await pool.query('UPDATE Users SET avatar_url = $1 WHERE id = $2', [avatar_url, user.id]);
                    user.avatar_url = avatar_url;
                }
            }

            await pool.query('UPDATE Users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

            const token = jwt.sign(
                { id: user.id, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: '1d' }
            );

            res.status(200).json({
                message: "Đăng nhập Google thành công!",
                token,
                user: {
                    id: user.id,
                    full_name: user.full_name,
                    email: user.email,
                    phone: user.phone,
                    date_of_birth: user.date_of_birth,
                    avatar_url: user.avatar_url,
                    loyalty_points: user.loyalty_points || 0,
                    role: user.role
                }
            });
        } catch (error) {
            console.error("Lỗi Google Auth:", error);
            res.status(500).json({ message: "Lỗi máy chủ khi xác thực Google" });
        }
    }
};

module.exports = authController;
