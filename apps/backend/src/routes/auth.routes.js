const express = require('express');
const { login, getMe, refresh, logout } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { loginIpLimiter, loginAccountLimiter, refreshLimiter } = require('../middleware/rateLimiter');


const router = express.Router();

router.post('/login',loginIpLimiter, loginAccountLimiter, login);
router.post('/refresh', refreshLimiter, refresh);
router.post('/logout', logout);

router.get('/me', authenticate, getMe);

module.exports = router;