const { verifyAccessToken } = require('../utils/jwt');

// Runs before any protected route. Reads the token, checks it,
// and attaches the user's identity to req.user.
function authenticate(req, res, next) {
  // Tokens arrive as:  Authorization: Bearer <token>
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed token' });
  }

  try {
    const claims = verifyAccessToken(token);

    // Copy only the fields we expect, using the agreed names.
    // The AI service reads these, so they must come from the token,
    // never from the request body.
    req.user = {
      user_id: claims.user_id,
      org_id: claims.org_id,
      workspace_id: claims.workspace_id,
      department_id: claims.department_id,
      role: claims.role,
    };
    next();
  } catch (err) {
    // Fake, edited, or expired token
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Use after authenticate: only lets listed roles through.
// Example: router.post('/users', authenticate, requireRole('Admin'), handler)
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };