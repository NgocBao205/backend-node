const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER ? process.env.EMAIL_USER.replace(/"/g, '') : '',
        pass: process.env.EMAIL_PASS ? process.env.EMAIL_PASS.replace(/"/g, '') : ''
    }
});

const sendMail = async ({ to, subject, html }) => {
    try {
        const fromEmail = process.env.EMAIL_USER ? process.env.EMAIL_USER.replace(/"/g, '') : 'cinemavnam@gmail.com';
        const info = await transporter.sendMail({
            from: `"CINEVIE Cinema" <${fromEmail}>`,
            to,
            subject,
            html
        });
        console.log(`[Email Sent] Message ID: ${info.messageId} to ${to}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error(`[Email Error] Không thể gửi email tới ${to}:`, error.message);
        return { success: false, error: error.message };
    }
};

module.exports = {
    transporter,
    sendMail
};
