const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { signAccessToken } = require('../utils/jwt');

const prisma = new PrismaClient();

async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find the user, and follow department -> workspace to get org_id
    const user = await prisma.user.findUnique({
      where: { email },
      include: { department: { include: { workspace: true } } },
    });

    // Compare the typed password with the stored hash
    const ok = user && (await bcrypt.compare(password, user.password_hash));

    // Same message for "no such user" and "wrong password",
    // so attackers can't tell which emails exist
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // These exact field names are the contract with the AI service
    const access_token = signAccessToken({
      user_id: user.id,
      org_id: user.department.workspace.org_id,
      workspace_id: user.department.workspace_id,
      department_id: user.department_id,
      role: user.role,
    });

    res.json({ access_token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

module.exports = { login };