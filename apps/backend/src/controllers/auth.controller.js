const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { signAccessToken } = require('../utils/jwt');
const {
  generateRefreshToken,
  hashToken,
  refreshExpiry,
} = require('../utils/refreshToken');

const prisma = new PrismaClient();

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

// Account lockout: after this many failed attempts the account is locked...
const MAX_FAILED_ATTEMPTS = 5;
// ... for this long (15 minutes)
const LOCKOUT_MS = 15 * 60 * 1000;

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

    // Unknown email and wrong password answer the same way
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    // Locked accounts cannot log in, even with the correct password
    if (user.locked_until && user.locked_until > new Date()) {
      return res.status(423).json({
        error: 'Account locked due to too many failed attempts. Try again later.',
        code: 'ACCOUNT_LOCKED',
        locked_until: user.locked_until,
      });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      // Count the failure; the 5th one locks the account for 15 minutes
      const failed_login_attempts = user.failed_login_attempts + 1;
      const data = { failed_login_attempts };
      if (failed_login_attempts >= MAX_FAILED_ATTEMPTS) {
        data.locked_until = new Date(Date.now() + LOCKOUT_MS);
      }
      await prisma.user.update({ where: { id: user.id }, data });
      return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    // Deactivated accounts cannot log in
    if (!user.active) {
      return res.status(403).json({
        error: 'Account deactivated. Contact your administrator.',
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    // Successful login — clear any leftover counter or expired lock
    if (user.failed_login_attempts !== 0 || user.locked_until !== null) {
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

module.exports = { login, getMe, refresh, logout };