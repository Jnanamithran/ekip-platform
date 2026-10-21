const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { validatePassword } = require('../utils/passwordPolicy');
const { PERMISSIONS } = require('../utils/permissions');
const prisma = new PrismaClient();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Finds a member only inside the caller's organization.
function findUserInOrg(id, orgId) {
  return prisma.user.findFirst({
    where: { id, department: { workspace: { org_id: orgId } } },
    select: {
      id: true,
      email: true,
      role_id: true,
      role: { select: { id: true, name: true, is_owner: true, permissions: true } },
      department_id: true,
      active: true,
    },
  });
}
function permissionsWithinActor(permissions, req) {
  return req.user.is_owner ||
    permissions.every((permission) => req.user.permissions.includes(permission));
}

async function findAssignableRole(roleId, orgId) {
  return prisma.organizationRole.findFirst({
    where: { id: roleId, org_id: orgId, is_owner: false },
    select: { id: true, name: true, permissions: true },
  });
}

async function isOrganizationOwner(userId, orgId) {
  const organization = await prisma.organization.findFirst({
    where: { id: orgId, owner_user_id: userId },
    select: { id: true },
  });
  return Boolean(organization);
}

// POST /admin/users
async function createUser(req, res) {
  try {
    const { email, password, role_id: roleId, department_id: departmentId } = req.body || {};

    if (![email, password, roleId, departmentId].every((v) => typeof v === 'string' && v)) {
      return res.status(400).json({
        error: 'email, password, role_id and department_id are required',
      });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length) {
      return res.status(400).json({ error: passwordErrors.join(' '), code: 'WEAK_PASSWORD' });
    }
    const [department, role] = await Promise.all([
      prisma.department.findFirst({
        where: { id: departmentId, workspace: { org_id: req.user.org_id } },
        select: { id: true },
      }),
      findAssignableRole(roleId, req.user.org_id),
    ]);
    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }
    if (!permissionsWithinActor(role.permissions, req)) {
      return res.status(403).json({ error: 'You cannot assign a role with permissions you do not have' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        password_hash,
        role_id: role.id,
        department_id: department.id,
      },
      select: {
        id: true,
        email: true,
        role_id: true,
        role: { select: { id: true, name: true } },
        department_id: true,
        active: true,
      },
    });

    res.status(201).json({
      user: { ...user, role: role.name, role_is_owner: false },
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
// GET /admin/users
// Optional filters: ?department_id=...&role_id=...&limit=50&offset=0
async function listUsers(req, res) {
  try {
    const { department_id: departmentId, role_id: roleId } = req.query;

    // Read limit/offset as numbers, with safe defaults and a cap
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    // The org filter always comes from the token, never from the request.
    // The other filters only narrow the result inside that org.
    const where = {
      department: { workspace: { org_id: req.user.org_id } },
      ...(departmentId && { department_id: departmentId }),
      ...(roleId && { role_id: roleId }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          role_id: true,
          role: { select: { id: true, name: true, is_owner: true } },
          department_id: true,
          active: true,
        },
        orderBy: { email: 'asc' },
        take: limit,
        skip: offset,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      users: users.map(({ role, ...user }) => ({
        ...user,
        role: role.name,
        role_is_owner: role.is_owner,
      })),
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}
// POST /admin/workspaces  (Admin only)
async function createWorkspace(req, res) {
  try {
    const { name } = req.body || {};

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    // org_id comes from the token, never from the request body,
    // so an admin can only create workspaces in their own organization
    const workspace = await prisma.workspace.create({
      data: { name: name.trim(), org_id: req.user.org_id },
      select: { id: true, name: true, org_id: true },
    });

    res.status(201).json({ workspace });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// GET /admin/workspaces  (Admin only)
// Lists the workspaces of the admin's own organization
async function listWorkspaces(req, res) {
  try {
    const workspaces = await prisma.workspace.findMany({
      where: { org_id: req.user.org_id },
      select: { id: true, name: true, org_id: true },
      orderBy: { name: 'asc' },
    });

    res.json({ workspaces });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// GET /admin/workspaces/:workspaceId (Admin only)
async function getWorkspaceDashboard(req, res) {
  try {
    const workspace = await prisma.workspace.findFirst({
      where: { id: req.params.workspaceId, org_id: req.user.org_id },
      select: {
        id: true,
        name: true,
        organization: { select: { name: true } },
        departments: {
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            _count: { select: { users: true, documents: true } },
            users: {
              orderBy: { email: 'asc' },
              select: {
                id: true,
                email: true,
                role: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const departments = workspace.departments.map((department) => ({
      id: department.id,
      name: department.name,
      member_count: department._count.users,
      document_count: department._count.documents,
      members: department.users.map(({ role, ...member }) => ({
        ...member,
        role_id: role.id,
        role: role.name,
      })),
    }));

    res.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        organization_name: workspace.organization.name,
        departments,
        stats: {
          members: departments.reduce((total, department) => total + department.member_count, 0),
          departments: departments.length,
          documents: departments.reduce((total, department) => total + department.document_count, 0),
        },
      },
    });
  } catch (err) {
    console.error('[admin] workspace dashboard lookup failed:', err.message);
    res.status(500).json({ error: 'Failed to load workspace dashboard' });
  }
}

// PATCH /admin/workspaces/:workspaceId (Admin only)
async function updateWorkspace(req, res) {
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
    return res.status(400).json({ error: 'Workspace name must be between 1 and 120 characters' });
  }

  try {
    const result = await prisma.workspace.updateMany({
      where: { id: req.params.workspaceId, org_id: req.user.org_id },
      data: { name: name.trim() },
    });
    if (!result.count) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: req.params.workspaceId },
      select: { id: true, name: true },
    });
    res.json({ workspace });
  } catch (err) {
    console.error('[admin] workspace update failed:', err.message);
    res.status(500).json({ error: 'Failed to update workspace' });
  }
}

// POST /admin/departments  (Admin only)
async function createDepartment(req, res) {
  try {
    const { workspace_id, name } = req.body || {};

    if (typeof workspace_id !== 'string' || !workspace_id ||
        typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'workspace_id and name are required' });
    }

    // The workspace must belong to the admin's OWN organization.
    // Same answer for "doesn't exist" and "not yours".
    const workspace = await prisma.workspace.findFirst({
      where: { id: workspace_id, org_id: req.user.org_id },
    });
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const department = await prisma.department.create({
      data: { name: name.trim(), workspace_id },
      select: { id: true, name: true, workspace_id: true },
    });

    res.status(201).json({ department });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// GET /admin/departments  (Admin only)
// Optional filter: ?workspace_id=...
async function listDepartments(req, res) {
  try {
    const { workspace_id } = req.query;

    // The org filter comes from the token. workspace_id only narrows the result.
    const departments = await prisma.department.findMany({
      where: {
        workspace: { org_id: req.user.org_id },
        ...(workspace_id && { workspace_id }),
      },
      select: { id: true, name: true, workspace_id: true },
      orderBy: { name: 'asc' },
    });

    res.json({ departments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}
// PATCH /admin/users/:id
async function updateUser(req, res) {
  try {
    const target = await findUserInOrg(req.params.id, req.user.org_id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (await isOrganizationOwner(target.id, req.user.org_id)) {
      return res.status(403).json({ error: 'The organization Owner account cannot be changed here' });
    }

    const { email, role_id: roleId, department_id: departmentId } = req.body || {};
    const data = {};

    if (email !== undefined) {
      if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      data.email = email.trim().toLowerCase();
    }

    if (roleId !== undefined) {
      if (target.id === req.user.user_id) {
        return res.status(400).json({ error: 'You cannot change your own role' });
      }
      const role = await findAssignableRole(roleId, req.user.org_id);
      if (!role) return res.status(404).json({ error: 'Role not found' });
      if (!permissionsWithinActor(role.permissions, req)) {
        return res.status(403).json({ error: 'You cannot assign a role with permissions you do not have' });
      }
      data.role_id = role.id;
    }

    if (departmentId !== undefined) {
      const dept = await prisma.department.findFirst({
        where: { id: departmentId, workspace: { org_id: req.user.org_id } },
      });
      if (!dept) return res.status(404).json({ error: 'Department not found' });
      data.department_id = departmentId;
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const user = await prisma.user.update({
      where: { id: target.id },
      data,
      select: {
        id: true,
        email: true,
        role_id: true,
        role: { select: { id: true, name: true, is_owner: true } },
        department_id: true,
        active: true,
      },
    });
    res.json({
      user: {
        ...user,
        role: user.role.name,
        role_is_owner: user.role.is_owner,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// POST /admin/users/:id/reset-password  (Admin only)
async function resetPassword(req, res) {
  try {
    const target = await findUserInOrg(req.params.id, req.user.org_id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (
      target.role.is_owner ||
      await isOrganizationOwner(target.id, req.user.org_id)
    ) {
      return res.status(403).json({ error: 'The organization Owner must change their own password' });
    }
    if (target.id === req.user.user_id) {
      return res.status(400).json({ error: 'Use self-service password change for your account' });
    }

    const tempPassword = crypto.randomBytes(9).toString('base64url');
    const password_hash = await bcrypt.hash(tempPassword, 10);

    await prisma.$transaction([
      // A reset also clears any account lock, so the user can log in
      // with the new password right away
      prisma.user.update({
        where: { id: target.id },
        data: { password_hash, failed_login_attempts: 0, locked_until: null },
      }),
      prisma.refreshToken.deleteMany({ where: { user_id: target.id } }),
    ]);

    res.json({ temp_password: tempPassword, message: 'Share this with the user securely.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// Shared by deactivate and reactivate
async function setActive(req, res, active) {
  try {
    const target = await findUserInOrg(req.params.id, req.user.org_id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (
      target.role.is_owner ||
      await isOrganizationOwner(target.id, req.user.org_id)
    ) {
      return res.status(403).json({ error: 'The organization Owner account cannot be deactivated' });
    }

    if (!active && target.id === req.user.user_id) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    if (active) {
      await prisma.user.update({ where: { id: target.id }, data: { active: true } });
    } else {
      await prisma.$transaction([
        prisma.user.update({ where: { id: target.id }, data: { active: false } }),
        prisma.refreshToken.deleteMany({ where: { user_id: target.id } }),
      ]);
    }
    res.json({ message: active ? 'User reactivated.' : 'User deactivated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

const deactivateUser = (req, res) => setActive(req, res, false);
const reactivateUser = (req, res) => setActive(req, res, true);
// GET /admin/analytics/queries  (Admin only)
// Questions asked per day over the last 7 days (UTC), for the admin's own organization
async function queryAnalytics(req, res) {
  try {
    const DAYS = 7;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const firstDayStart = todayStart - (DAYS - 1) * DAY_MS;

    // History rows only store user_id, so find this organization's users first.
    // The org comes from the token, never from the request.
    const users = await prisma.user.findMany({
      where: { department: { workspace: { org_id: req.user.org_id } } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);

    const rows = userIds.length
      ? await prisma.aiAnswerHistory.findMany({
          where: { user_id: { in: userIds }, created_at: { gte: new Date(firstDayStart) } },
          select: { created_at: true },
        })
      : [];

    // Count rows per day
    const counts = {};
    for (const row of rows) {
      const day = row.created_at.toISOString().slice(0, 10);
      counts[day] = (counts[day] || 0) + 1;
    }

    // Always return all 7 days, oldest first, even when the count is 0
    const data = [];
    for (let i = 0; i < DAYS; i++) {
      const day = new Date(firstDayStart + i * DAY_MS).toISOString().slice(0, 10);
      data.push({ date: day, count: counts[day] || 0 });
    }

    res.json({ data });
  } catch (err) {
    console.error('[admin] query analytics failed:', err.message);
    res.status(500).json({ error: 'Failed to load query analytics' });
  }
}
module.exports = {
  updateUser,
  resetPassword,
  deactivateUser,
  reactivateUser,
  createUser,
  listUsers,
  createWorkspace,
  listWorkspaces,
  getWorkspaceDashboard,
  updateWorkspace,
  createDepartment,
  listDepartments,
  queryAnalytics,
};