const express = require('express');
const { login, getMe, refresh, logout, changePassword } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { loginIpLimiter, loginAccountLimiter, refreshLimiter } = require('../middleware/rateLimiter');


const router = express.Router();

router.post('/login',loginIpLimiter, loginAccountLimiter, login);
router.post('/refresh', refreshLimiter, refresh);
router.post('/logout', logout);

router.get('/me', authenticate, getMe);
router.post('/change-password', authenticate, changePassword);

module.exports = router;