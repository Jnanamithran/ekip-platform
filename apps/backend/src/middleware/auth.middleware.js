const { verifyAccessToken } = require('../utils/jwt');
const { PrismaClient } = require('@prisma/client');
const { OWNER_PERMISSIONS } = require('../utils/permissions');

const prisma = new PrismaClient();

// Runs before any protected route. Reads the token, checks it,
// and attaches the user's identity to req.user.
async function authenticate(req, res, next) {
  // Tokens arrive as:  Authorization: Bearer <token>
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed token' });
  }

  try {
    const claims = verifyAccessToken(token);
    if (typeof claims.user_id !== 'string') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: claims.user_id },
      select: {
        id: true,
        email: true,
        active: true,
        role_id: true,
        department_id: true,
        role: { select: { id: true, name: true, permissions: true, is_owner: true } },
        department: {
          select: {
            name: true,
            workspace_id: true,
            workspace: {
              select: {
                org_id: true,
                organization: { select: { owner_user_id: true } },
              },
            },
          },
        },
      },
    });
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Invalid or inactive account' });
    }
    const isOwner = user.department.workspace.organization.owner_user_id === user.id;

    req.user = {
      user_id: user.id,
      email: user.email,
      org_id: user.department.workspace.org_id,
      workspace_id: user.department.workspace_id,
      department_id: user.department_id,
      department: user.department.name,
      role_id: user.role_id,
      role: isOwner ? 'Owner' : user.role.name,
      permissions: isOwner ? OWNER_PERMISSIONS : user.role.permissions,
      is_owner: isOwner,
    };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.error('[auth] request authentication failed:', err.message);
    return res.status(500).json({ error: 'Could not authenticate request' });
  }
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (
      !req.user ||
      (!req.user.is_owner && !req.user.permissions.includes(permission))
    ) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    next();
  };
}

function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (
      !req.user ||
      (!req.user.is_owner &&
        !permissions.some((permission) => req.user.permissions.includes(permission)))
    ) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    next();
  };
}

module.exports = { authenticate, requirePermission, requireAnyPermission };