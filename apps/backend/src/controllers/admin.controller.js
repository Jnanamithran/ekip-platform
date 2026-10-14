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
module.exports = {
  createUser,
  listUsers,
  createWorkspace,
  listWorkspaces,
  createDepartment,
  listDepartments,
};