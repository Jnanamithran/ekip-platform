const express = require('express');
const { login, refresh, logout } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;