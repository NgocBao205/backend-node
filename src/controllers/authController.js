const pool = require('../config/db');
const redis = require('../config/redis');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendMail } = require('../config/mailer');
const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client('223381933983-msnabh38kh3tj01fpdq7c7vn890id9om.apps.googleusercontent.com');

const authController = {
    // 1. API Đăng ký tài khoản
    register: async (req, res) => {
        try {
            const { full_name, email, password, phone, date_of_birth, fax_number } = req.body;

            if (fax_number) {
                return res.status(400).json({ message: "Yêu cầu không hợp lệ!" });
            }

            if (!full_name || !full_name.trim() || full_name.trim().length < 2) {
                return res.status(400).json({ message: "Vui lòng nhập họ và tên hợp lệ (tối thiểu 2 ký tự)!" });
            }

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

            if (!password || password.length < 8) {
                return res.status(400).json({ message: "Mật khẩu phải chứa ít nhất 8 ký tự!" });
            }
            const specialCharRegex = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;
            if (!specialCharRegex.test(password)) {
                return res.status(400).json({ message: "Mật khẩu phải chứa ít nhất 1 ký tự đặc biệt (Ví dụ: @, #, $, %,...)!" });
            }

            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(password, salt);

            const newUser = await pool.query(
                `INSERT INTO Users (full_name, email, password_hash, phone, date_of_birth, avatar_url, loyalty_points, role, status) 
                 VALUES ($1, $2, $3, $4, $5, NULL, 0, 'Customer', 'Active') 
                 RETURNING id, full_name, email, phone, date_of_birth, loyalty_points, role`,
                [full_name.trim(), cleanEmail, password_hash, cleanPhone, date_of_birth]
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

    // 2. API Đăng nhập
    login: async (req, res) => {
        try {
            const { email, password, portal = 'client', fax_number } = req.body;

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

            if (portal === 'client' && currentUser.role === 'Admin') {
                return res.status(403).json({
                    role: 'Admin',
                    message: "Đây là tài khoản Quản Trị Viên! Vui lòng truy cập Cổng Quản Trị Nội Bộ (/portal-qtv-99x) để đăng nhập."
                });
            }

            if (portal === 'admin' && currentUser.role !== 'Admin') {
                return res.status(403).json({
                    message: "Truy cập bị từ chối: Cổng này chỉ dành riêng cho tài khoản Quản Trị Viên (Admin)!"
                });
            }

            await pool.query('UPDATE Users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [currentUser.id]);

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

    // 3. API Quên mật khẩu: Gửi mã OTP THẬT qua Gmail bằng Nodemailer
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

            const userName = userRes.rows[0].full_name;
            const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

            try {
                if (redis && redis.set) {
                    await redis.set(`reset_otp:${cleanEmail}`, otpCode, { ex: 300 });
                }
            } catch (redisErr) {
                console.warn("Lưu OTP Redis lỗi:", redisErr.message);
            }

            // Gửi email thật tới hòm thư người dùng
            const mailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 550px; margin: 0 auto; background-color: #0b0f19; color: #f3f4f6; padding: 30px; border-radius: 16px; border: 1px solid #1f2937;">
                    <div style="text-align: center; margin-bottom: 25px;">
                        <h2 style="color: #e11d48; margin: 0; font-size: 26px; font-weight: 900; letter-spacing: 2px;">CINE<span style="color: #f59e0b;">VIE</span></h2>
                        <p style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Cinema Experience</p>
                    </div>
                    <div style="background-color: #111827; padding: 25px; border-radius: 12px; border: 1px solid #374151;">
                        <h3 style="color: #ffffff; margin-top: 0;">Chào bạn ${userName},</h3>
                        <p style="color: #d1d5db; font-size: 14px; line-height: 1.6;">Bạn vừa gửi yêu cầu khôi phục mật khẩu tài khoản CINEVIE. Dưới đây là mã xác thực OTP của bạn:</p>
                        <div style="text-align: center; margin: 25px 0;">
                            <span style="display: inline-block; font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #f59e0b; background-color: #030712; padding: 12px 28px; border-radius: 10px; border: 1px dashed #f59e0b;">${otpCode}</span>
                        </div>
                        <p style="color: #ef4444; font-size: 13px; margin-bottom: 0;">* Mã OTP có hiệu lực trong vòng <b>5 phút</b>. Tuyệt đối không chia sẻ mã này cho bất kỳ ai để bảo vệ tài khoản.</p>
                    </div>
                    <div style="text-align: center; margin-top: 25px; font-size: 11px; color: #6b7280;">
                        <p>© 2026 CINEVIE Cinema. Hệ thống đặt vé xem phim trực tuyến hiện đại.</p>
                    </div>
                </div>
            `;

            const emailResult = await sendMail({
                to: cleanEmail,
                subject: `[CINEVIE] Mã xác thực OTP đặt lại mật khẩu: ${otpCode}`,
                html: mailHtml
            });

            console.log(`[CINEVIE OTP GMAIL] Đã gửi OTP ${otpCode} tới ${cleanEmail}`);

            res.status(200).json({
                message: `Mã OTP đã được gửi thành công vào hộp thư Gmail của bạn (${cleanEmail})! Vui lòng kiểm tra hộp thư đến hoặc thư rác.`,
                email_sent: emailResult.success
            });
        } catch (error) {
            console.error("Lỗi gửi OTP quên mật khẩu:", error);
            res.status(500).json({ message: "Lỗi máy chủ khi gửi email OTP" });
        }
    },

    // 4. API Đặt lại mật khẩu mới
    resetPassword: async (req, res) => {
        try {
            const { email, otp, new_password } = req.body;

            if (!email || !otp || !new_password) {
                return res.status(400).json({ message: "Vui lòng nhập đầy đủ Email, Mã OTP và Mật khẩu mới!" });
            }

            const cleanEmail = email.trim().toLowerCase();

            let storedOtp = null;
            try {
                if (redis && redis.get) {
                    storedOtp = await redis.get(`reset_otp:${cleanEmail}`);
                }
            } catch (redisErr) {}

            if (storedOtp && storedOtp.toString() !== otp.toString().trim()) {
                return res.status(400).json({ message: "Mã OTP không chính xác hoặc đã hết hạn!" });
            }

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

    // 5. API Đăng nhập / Đăng ký THẬT qua Google OAuth Credential
    googleAuth: async (req, res) => {
        try {
            const { credential } = req.body;

            if (!credential) {
                return res.status(400).json({ message: "Thiếu token xác thực từ Google!" });
            }

            // Verify Google ID Token thật 100% với Google Server
            const ticket = await googleClient.verifyIdToken({
                idToken: credential,
                audience: '223381933983-msnabh38kh3tj01fpdq7c7vn890id9om.apps.googleusercontent.com'
            });

            const payload = ticket.getPayload();
            const { email, name, picture, sub } = payload;

            if (!email) {
                return res.status(400).json({ message: "Không tìm thấy email trong tài khoản Google này!" });
            }

            const cleanEmail = email.trim().toLowerCase();
            let userQuery = await pool.query('SELECT * FROM Users WHERE email = $1', [cleanEmail]);

            let user;
            if (userQuery.rows.length === 0) {
                const randomPass = Math.random().toString(36).slice(-10) + '!@#Cinevie';
                const salt = await bcrypt.genSalt(10);
                const password_hash = await bcrypt.hash(randomPass, salt);

                const insertRes = await pool.query(
                    `INSERT INTO Users (full_name, email, password_hash, avatar_url, role, status)
                     VALUES ($1, $2, $3, $4, 'Customer', 'Active')
                     RETURNING id, full_name, email, phone, date_of_birth, avatar_url, loyalty_points, role`,
                    [name || 'Thành viên Google', cleanEmail, password_hash, picture || null]
                );
                user = insertRes.rows[0];
            } else {
                user = userQuery.rows[0];
                if (user.status === 'Banned') {
                    return res.status(403).json({ message: "Tài khoản của bạn đã bị khóa bởi Quản trị viên!" });
                }
                if (!user.avatar_url && picture) {
                    await pool.query('UPDATE Users SET avatar_url = $1 WHERE id = $2', [picture, user.id]);
                    user.avatar_url = picture;
                }
            }

            await pool.query('UPDATE Users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

            const token = jwt.sign(
                { id: user.id, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: '1d' }
            );

            res.status(200).json({
                message: `Chào mừng ${user.full_name} đã đăng nhập thành công qua Google!`,
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
            console.error("Lỗi Google Auth Token Verify:", error.message);
            res.status(400).json({ message: `Xác thực Google thất bại: ${error.message}` });
        }
    },

    // 6. Gửi form Liên hệ khách hàng tới Gmail cinemavnam@gmail.com
    sendContactMail: async (req, res) => {
        try {
            const { name, email, topic, message } = req.body;
            if (!name || !email || !message) {
                return res.status(400).json({ message: "Vui lòng điền đầy đủ Họ tên, Email và Nội dung phản hồi!" });
            }

            const receiverEmail = process.env.EMAIL_USER ? process.env.EMAIL_USER.replace(/"/g, '') : 'cinemavnam@gmail.com';
            const mailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0f19; color: #f3f4f6; padding: 30px; border-radius: 16px; border: 1px solid #1f2937;">
                    <div style="border-bottom: 2px solid #e11d48; padding-bottom: 15px; margin-bottom: 20px;">
                        <h2 style="color: #f59e0b; margin: 0; font-size: 20px;">[CINEVIE] Thư Liên Hệ Mới Từ Khách Hàng</h2>
                        <span style="font-size: 12px; color: #9ca3af;">Gửi vào: ${new Date().toLocaleString('vi-VN')}</span>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <tr>
                            <td style="padding: 8px 0; color: #9ca3af; width: 140px;"><b>Khách hàng:</b></td>
                            <td style="padding: 8px 0; color: #ffffff;">${name}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #9ca3af;"><b>Email gửi:</b></td>
                            <td style="padding: 8px 0; color: #f59e0b;">${email}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #9ca3af;"><b>Chủ đề:</b></td>
                            <td style="padding: 8px 0; color: #e11d48; font-weight: bold;">${topic || 'Góp ý chung'}</td>
                        </tr>
                    </table>
                    <div style="background-color: #111827; padding: 20px; border-radius: 10px; margin-top: 20px; border: 1px solid #374151;">
                        <b style="color: #d1d5db; font-size: 13px; display: block; margin-bottom: 10px;">Nội dung tin nhắn:</b>
                        <p style="color: #ffffff; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-line;">${message}</p>
                    </div>
                </div>
            `;

            await sendMail({
                to: receiverEmail,
                subject: `[CINEVIE Phản Hồi] ${topic || 'Liên Hệ Từ Khách Hàng'} - ${name}`,
                html: mailHtml
            });

            res.status(200).json({
                message: "Tin nhắn phản hồi của bạn đã được gửi trực tiếp đến hòm thư Ban Quản Trị CINEVIE!"
            });
        } catch (error) {
            console.error("Lỗi gửi email liên hệ:", error);
            res.status(500).json({ message: "Lỗi máy chủ khi gửi email liên hệ" });
        }
    }
};

module.exports = authController;
