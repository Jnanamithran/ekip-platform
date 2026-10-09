const jwt = require('jsonwebtoken');

// Short-lived: if a token leaks, it stops working after 15 minutes
function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
}

// Throws an error if the token is fake, edited, or expired
function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { signAccessToken, verifyAccessToken };