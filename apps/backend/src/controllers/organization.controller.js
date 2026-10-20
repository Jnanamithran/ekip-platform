const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { validatePassword } = require('../utils/passwordPolicy');

const prisma = new PrismaClient();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

// POST /organizations  (public: onboarding of a new organization)
// Creates the organization, a default workspace and department,
// and the first Admin user, all in one request.
async function createOrganization(req, res) {
  try {
    const {
      organization_name,
      admin_email,
      admin_password,
      workspace_name,
      department_name,
    } = req.body || {};

    if (![organization_name, admin_email, admin_password].every(isText)) {
      return res.status(400).json({
        error: 'organization_name, admin_email and admin_password are required',
      });
    }
    if (!EMAIL_RE.test(admin_email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    const passwordErrors = validatePassword(admin_password);
    if (passwordErrors.length) {
      return res.status(400).json({ error: passwordErrors.join(' '), code: 'WEAK_PASSWORD' });
    }

    const password_hash = await bcrypt.hash(admin_password, 10);

    // One nested create: either everything is saved or nothing is
    const org = await prisma.organization.create({
      data: {
        name: organization_name.trim(),
        workspaces: {
          create: {
            name: isText(workspace_name) ? workspace_name.trim() : 'Main Workspace',
            departments: {
              create: {
                name: isText(department_name) ? department_name.trim() : 'General',
                users: {
                  create: {
                    email: admin_email.trim().toLowerCase(),
                    password_hash,
                    role: 'Admin',
                  },
                },
              },
            },
          },
        },
      },
      include: {
        workspaces: {
          include: {
            departments: {
              include: { users: { select: { id: true, email: true, role: true } } },
            },
          },
        },
      },
    });

    const workspace = org.workspaces[0];
    const department = workspace.departments[0];

    res.status(201).json({
      organization: { id: org.id, name: org.name },
      workspace: { id: workspace.id, name: workspace.name },
      department: { id: department.id, name: department.name },
      admin: department.users[0],
    });
  } catch (err) {
    // P2002 = unique constraint failed (email already exists)
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

module.exports = { createOrganization };