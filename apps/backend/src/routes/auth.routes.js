const express = require('express');
const { login } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

// 1. Create the router first
const router = express.Router();

// 2. Then attach routes to it
router.post('/login', login);

// Returns whatever the middleware found in the token
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;