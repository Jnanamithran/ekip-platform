const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { signAccessToken } = require('../utils/jwt');
const {
  generateRefreshToken,
  hashToken,
  refreshExpiry,
} = require('../utils/refreshToken');
const { validatePassword } = require('../utils/passwordPolicy');

const prisma = new PrismaClient();
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const ACCOUNT_LOCKOUT_MS = 15 * 60 * 1000;

// Load a user together with the department -> workspace chain,
// so we can work out org_id
const withOrg = { department: { include: { workspace: true } } };

// Builds the access token with the agreed field names
function buildAccessToken(user) {
  return signAccessToken({
    user_id: user.id,
    org_id: user.department.workspace.org_id,
    workspace_id: user.department.workspace_id,
    department_id: user.department_id,
    role: user.role,
  });
}

// Creates a refresh token, stores only its hash, returns the real one
async function createRefreshToken(userId) {
  const token = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      user_id: userId,
      token_hash: hashToken(token),
      expires_at: refreshExpiry(),
    },
  });
  return token;
}

async function recordFailedLogin(userId) {
  return prisma.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: { role: true, locked_until: true },
    });
    if (!user || user.role === 'Admin') return null;

    const now = new Date();
    if (user.locked_until && user.locked_until > now) {
      return user.locked_until;
    }
    if (user.locked_until) {
      await transaction.user.updateMany({
        where: { id: userId, locked_until: { lte: now } },
        data: { failed_login_attempts: 0, locked_until: null },
      });
    }

    const updatedUser = await transaction.user.update({
      where: { id: userId },
      data: { failed_login_attempts: { increment: 1 } },
    });
    if (updatedUser.failed_login_attempts < MAX_FAILED_LOGIN_ATTEMPTS) {
      return null;
    }

    const lockedUntil = new Date(Date.now() + ACCOUNT_LOCKOUT_MS);
    await transaction.user.update({
      where: { id: userId },
      data: { locked_until: lockedUntil },
    });
    return lockedUntil;
  });
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: withOrg,
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const now = new Date();
    if (user.role !== 'Admin' && user.locked_until > now) {
      return res.status(423).json({
        error: `Account locked. Try again after ${user.locked_until.toISOString()}.`,
        code: 'ACCOUNT_LOCKED',
        locked_until: user.locked_until.toISOString(),
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      if (user.role !== 'Admin') {
        const lockedUntil = await recordFailedLogin(user.id);
        if (lockedUntil) {
          return res.status(423).json({
            error: `Account locked. Try again after ${lockedUntil.toISOString()}.`,
            code: 'ACCOUNT_LOCKED',
            locked_until: lockedUntil.toISOString(),
          });
        }
      }
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Deactivated accounts cannot log in.
    if (!user.active) {
      return res.status(403).json({
        error: 'Account deactivated. Contact your administrator.',
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    if (user.failed_login_attempts || user.locked_until) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failed_login_attempts: 0, locked_until: null },
      });
    }
    res.json({
      access_token: buildAccessToken(user),
      refresh_token: await createRefreshToken(user.id),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({
        error: 'currentPassword and newPassword are required',
      });
    }

    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length) {
      return res.status(400).json({
        error: passwordErrors.join(' '),
        code: 'WEAK_PASSWORD',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.user_id },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentPasswordMatches = await bcrypt.compare(
      currentPassword,
      user.password_hash,
    );
    if (!currentPasswordMatches) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          password_hash,
          failed_login_attempts: 0,
          locked_until: null,
        },
      }),
      prisma.refreshToken.deleteMany({ where: { user_id: user.id } }),
    ]);

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

async function getMe(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.user_id },
      select: {
        id: true,
        email: true,
        role: true,
        department_id: true,
        department: {
          select: {
            name: true,
            workspace_id: true,
            workspace: { select: { org_id: true } },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        user_id: user.id,
        email: user.email,
        role: user.role,
        department: user.department.name,
        department_id: user.department_id,
        workspace_id: user.department.workspace_id,
        org_id: user.department.workspace.org_id,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// Swap a valid refresh token for a new access token.
// The old refresh token is deleted and a new one issued ("rotation"),
// so a stolen token can only be used once.
async function refresh(req, res) {
  try {
    const { refresh_token } = req.body || {};
    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token is required' });
    }

    const record = await prisma.refreshToken.findUnique({
      where: { token_hash: hashToken(refresh_token) },
      include: { user: { include: withOrg } },
    });

    if (!record) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Always remove the used token, whether it was expired or not
    await prisma.refreshToken.delete({ where: { id: record.id } });

    if (record.expires_at < new Date()) {
      return res.status(401).json({ error: 'Refresh token expired' });
    }
    if (!record.user.active) {
      return res.status(403).json({
        error: 'Account deactivated. Contact your administrator.',
        code: 'ACCOUNT_DEACTIVATED',
      });
    }
    // The user is re-read from the database, so a changed role or
    // department shows up in the new access token
    res.json({
      access_token: buildAccessToken(record.user),
      refresh_token: await createRefreshToken(record.user_id),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// Revokes a refresh token, so it can never be used again
async function logout(req, res) {
  try {
    const { refresh_token } = req.body || {};
    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token is required' });
    }

    await prisma.refreshToken.deleteMany({
      where: { token_hash: hashToken(refresh_token) },
    });

    res.json({ message: 'Logged out' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

module.exports = { login, changePassword, getMe, refresh, logout };