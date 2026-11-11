const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');

router.post('/', chatController.askChatbot); // Ai cũng có thể chat, không cần token

module.exports = router;