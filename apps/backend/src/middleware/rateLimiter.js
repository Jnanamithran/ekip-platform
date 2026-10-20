const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Reads a number from .env, falling back to a default
function envInt(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// Per logged-in user. Must run AFTER authenticate, so req.user exists.
// Falls back to the client IP if there is no user.
const byUser = (req) => (req.user && req.user.user_id) || ipKeyGenerator(req.ip);

// All limiters answer with the same JSON shape, plus a Retry-After header
function makeLimiter({ windowMs, limit, message, keyGenerator, skipSuccessfulRequests }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message, code: 'RATE_LIMITED' },
    ...(keyGenerator && { keyGenerator }),
    ...(skipSuccessfulRequests && { skipSuccessfulRequests }),
  });
}

// Login, part 1: limit failed attempts per IP, including for Admin accounts.
const loginIpLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: envInt('RATE_LIMIT_LOGIN_IP_MAX', 5),
  skipSuccessfulRequests: true,
  message: 'Too many login attempts from this network. Try again in 15 minutes.',
});

// Login, part 2: a strict limit per IP + email. Only failed logins count, so
// normal use never hits it, and one person's mistakes can't lock out another account.
const loginAccountLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: envInt('RATE_LIMIT_LOGIN_MAX', 5),
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    return `${ipKeyGenerator(req.ip)}|${email}`;
  },
  message: 'Too many failed logins for this account. Try again in 15 minutes.',
});

// Creating organizations is public, so it is the easiest thing to spam
const signupLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  limit: envInt('RATE_LIMIT_SIGNUP_MAX', 3),
  message: 'Too many organizations created from this network. Try again in 1 hour.',
});

const refreshLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: envInt('RATE_LIMIT_REFRESH_MAX', 20),
  message: 'Too many refresh attempts. Please wait a minute.',
});

// AI questions: each one loads Ollama, so limit per user
const queryLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: envInt('RATE_LIMIT_QUERY_MAX', 30),
  keyGenerator: byUser,
  message: 'Question limit reached. Please wait a minute.',
});

// Uploads: each one runs the whole ingestion pipeline
const uploadLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: envInt('RATE_LIMIT_UPLOAD_MAX', 10),
  keyGenerator: byUser,
  message: 'Upload limit reached. Please wait a minute.',
});

// Drive imports: one request can import up to 5 files
const importLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: envInt('RATE_LIMIT_IMPORT_MAX', 5),
  keyGenerator: byUser,
  message: 'Import limit reached. Please wait a minute.',
});

module.exports = {
  loginIpLimiter,
  loginAccountLimiter,
  signupLimiter,
  refreshLimiter,
  queryLimiter,
  uploadLimiter,
  importLimiter,
};