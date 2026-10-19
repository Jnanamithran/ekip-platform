const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// The key must be exactly 32 bytes (64 hex characters)
function getKey() {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || '', 'hex');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex characters');
  }
  return key;
}

// AES-256-GCM: encrypts AND detects tampering.
// Output format: iv.authTag.ciphertext (each base64)
function encryptToken(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString('base64')).join('.');
}

function decryptToken(payload) {
  const [iv, tag, encrypted] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// OAuth "state": a short-lived signed token that carries the user id
// through Google's redirect, so the callback knows who is connecting.
function signOAuthState(userId) {
  return jwt.sign({ user_id: userId }, process.env.OAUTH_STATE_SECRET, {
    algorithm: 'HS256',
    expiresIn: '10m',
  });
}

// Throws if the state is fake, edited or expired
function verifyOAuthState(state) {
  const claims = jwt.verify(state, process.env.OAUTH_STATE_SECRET, { algorithms: ['HS256'] });
  return claims.user_id;
}

module.exports = { encryptToken, decryptToken, signOAuthState, verifyOAuthState };