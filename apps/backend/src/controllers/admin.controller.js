const bcrypt = require('bcryptjs');
const { PrismaClient, Role } = require('@prisma/client');

const prisma = new PrismaClient();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /admin/users  (Admin only)
async function createUser(req, res) {
  try {
    const { email, password, role, department_id } = req.body || {};

    if (![email, password, role, department_id].every((v) => typeof v === 'string' && v)) {
      return res.status(400).json({
        error: 'email, password, role and department_id are required',
      });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!Object.values(Role).includes(role)) {
      return res.status(400).json({
        error: `role must be one of: ${Object.values(Role).join(', ')}`,
      });
    }

    // The department must belong to the admin's OWN organization.
    // Otherwise an admin could create users inside someone else's org.
    const department = await prisma.department.findUnique({
      where: { id: department_id },
      include: { workspace: true },
    });
    if (!department || department.workspace.org_id !== req.user.org_id) {
      // Same answer for "doesn't exist" and "not yours", so ids can't be probed
      return res.status(404).json({ error: 'Department not found' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        password_hash,
        role,
        department_id,
      },
      // Never send password_hash back
      select: { id: true, email: true, role: true, department_id: true },
    });

    res.status(201).json({ user });
  } catch (err) {
    // P2002 = unique constraint failed (email already exists)
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

module.exports = { createUser };