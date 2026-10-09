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

    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
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

module.exports = { login, refresh, logout };