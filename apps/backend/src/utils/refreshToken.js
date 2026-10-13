const crypto = require('crypto');

const REFRESH_DAYS = 7;

// A random, unguessable string. This is what the client keeps.
function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

// What we store in the database instead of the real token
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function refreshExpiry() {
  return new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
}

module.exports = { generateRefreshToken, hashToken, refreshExpiry };