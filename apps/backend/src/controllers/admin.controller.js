const bcrypt = require('bcryptjs');
const { PrismaClient, Role } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Finds a user only inside the admin's own organization
function findUserInOrg(id, orgId) {
  return prisma.user.findFirst({
    where: { id, department: { workspace: { org_id: orgId } } },
    select: { id: true, email: true, role: true, department_id: true, active: true },
  });
}
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
// GET /admin/users  (Admin only)
// Optional filters: ?department_id=...&role=...&limit=50&offset=0
async function listUsers(req, res) {
  try {
    const { department_id, role } = req.query;

    if (role && !Object.values(Role).includes(role)) {
      return res.status(400).json({
        error: `role must be one of: ${Object.values(Role).join(', ')}`,
      });
    }

    // Read limit/offset as numbers, with safe defaults and a cap
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    // The org filter always comes from the token, never from the request.
    // The other filters only narrow the result inside that org.
    const where = {
      department: { workspace: { org_id: req.user.org_id } },
      ...(department_id && { department_id }),
      ...(role && { role }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, email: true, role: true, department_id: true },
        orderBy: { email: 'asc' },
        take: limit,
        skip: offset,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users, total, limit, offset });
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
              select: { id: true, email: true, role: true },
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
      members: department.users,
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
// PATCH /admin/users/:id  (Admin only)
async function updateUser(req, res) {
  try {
    const target = await findUserInOrg(req.params.id, req.user.org_id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const { email, role, department_id } = req.body || {};
    const data = {};

    if (email !== undefined) {
      if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      data.email = email.trim().toLowerCase();
    }

    if (role !== undefined) {
      if (!Object.values(Role).includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${Object.values(Role).join(', ')}` });
      }
      if (target.id === req.user.user_id && role !== target.role) {
        return res.status(400).json({ error: 'You cannot change your own role' });
      }
      data.role = role;
    }

    if (department_id !== undefined) {
      const dept = await prisma.department.findFirst({
        where: { id: department_id, workspace: { org_id: req.user.org_id } },
      });
      if (!dept) return res.status(404).json({ error: 'Department not found' });
      data.department_id = department_id;
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const user = await prisma.user.update({
      where: { id: target.id },
      data,
      select: { id: true, email: true, role: true, department_id: true, active: true },
    });
    res.json({ user });
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

    const tempPassword = crypto.randomBytes(9).toString('base64url');
    const password_hash = await bcrypt.hash(tempPassword, 10);

    await prisma.$transaction([
      prisma.user.update({ where: { id: target.id }, data: { password_hash } }),
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