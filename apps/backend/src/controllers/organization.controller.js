const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { validatePassword } = require('../utils/passwordPolicy');
const { OWNER_PERMISSIONS } = require('../utils/permissions');

const prisma = new PrismaClient();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

// POST /organizations  (public: onboarding of a new organization)
// Creates the organization, its first workspace and department, and its
// immutable Owner in one transaction.
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
    const organization = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: organization_name.trim(),
          workspaces: {
            create: {
              name: isText(workspace_name) ? workspace_name.trim() : 'Main Workspace',
              departments: {
                create: {
                  name: isText(department_name) ? department_name.trim() : 'General',
                },
              },
            },
          },
        },
        include: { workspaces: { include: { departments: true } } },
      });

      const workspace = org.workspaces[0];
      const department = workspace.departments[0];
      const ownerRole = await tx.organizationRole.create({
        data: {
          org_id: org.id,
          name: 'Owner',
          permissions: OWNER_PERMISSIONS,
          is_owner: true,
        },
      });
      const owner = await tx.user.create({
        data: {
          email: admin_email.trim().toLowerCase(),
          password_hash,
          role_id: ownerRole.id,
          department_id: department.id,
        },
        select: { id: true, email: true, role_id: true },
      });
      await tx.organization.update({
        where: { id: org.id },
        data: { owner_user_id: owner.id },
      });
      return { org, workspace, department, owner };
    });

    res.status(201).json({
      organization: { id: organization.org.id, name: organization.org.name },
      workspace: { id: organization.workspace.id, name: organization.workspace.name },
      department: { id: organization.department.id, name: organization.department.name },
      owner: { id: organization.owner.id, email: organization.owner.email, role: 'Owner' },
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