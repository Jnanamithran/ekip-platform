const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { validatePassword } = require('../utils/passwordPolicy');
const { PERMISSIONS } = require('../utils/permissions');
const prisma = new PrismaClient();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function manageableDepartmentIds(user) {
  if (user.is_owner || user.role_scope !== 'department') return null;
  return [...new Set([
    user.role_department_id,
    ...(user.authorized_department_ids || []),
  ].filter(Boolean))];
}

// Finds a member only inside the caller's workspace.
function findUserInWorkspace(id, user) {
  const departmentIds = manageableDepartmentIds(user);
  return prisma.user.findFirst({
    where: {
      id,
      department: {
        workspace_id: user.workspace_id,
        ...(departmentIds && { id: { in: departmentIds } }),
      },
    },
    select: {
      id: true,
      email: true,
      role_id: true,
      role: {
        select: {
          id: true,
          name: true,
          is_owner: true,
          permissions: true,
          scope: true,
          department_id: true,
        },
      },
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
    where: {
      id: roleId,
      org_id: orgId,
      is_owner: false,
      scope_review_required: false,
    },
    select: {
      id: true,
      name: true,
      permissions: true,
      scope: true,
      department_id: true,
    },
  });
}

function validateRoleAssignment(role, departmentId, req) {
  if (role.scope !== 'department') return null;
  if (role.department_id !== departmentId) {
    return 'A department-scoped role can only be assigned to a user in its department';
  }
  if (
    !req.user.is_owner &&
    (
      !req.user.permissions.includes('departments:manage') ||
      !(req.user.department_ids || [req.user.department_id]).includes(role.department_id)
    )
  ) {
    return 'You need department-management access to assign a role for that department';
  }
  return null;
}

function validateManagedDepartment(departmentId, req) {
  const departmentIds = manageableDepartmentIds(req.user);
  if (departmentIds && !departmentIds.includes(departmentId)) {
    return 'You cannot manage users outside your department scope';
  }
  return null;
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
    const { email, password, role_id: roleId, department_id: departmentId, additional_department_ids: additionalDepartmentIds } = req.body || {};

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
        where: { id: departmentId, workspace: { id: req.user.workspace_id, org_id: req.user.org_id } },
        select: { id: true },
      }),
      findAssignableRole(roleId, req.user.org_id),
    ]);
    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }
    const departmentAccessError = validateManagedDepartment(department.id, req);
    if (departmentAccessError) return res.status(403).json({ error: departmentAccessError });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }
    const assignmentError = validateRoleAssignment(role, department.id, req);
    if (assignmentError) return res.status(403).json({ error: assignmentError });
    if (!permissionsWithinActor(role.permissions, req)) {
      return res.status(403).json({ error: 'You cannot assign a role with permissions you do not have' });
    }

    let normalizedAdditionalIds = [];
    if (additionalDepartmentIds !== undefined) {
      if (!Array.isArray(additionalDepartmentIds) || additionalDepartmentIds.some((id) => typeof id !== 'string' || !id)) {
        return res.status(400).json({ error: 'additional_department_ids must be an array of department IDs' });
      }
      normalizedAdditionalIds = [...new Set(additionalDepartmentIds.filter((id) => id !== departmentId))];
      const inaccessibleDepartment = normalizedAdditionalIds.find(
        (id) => validateManagedDepartment(id, req)
      );
      if (inaccessibleDepartment) {
        return res.status(403).json({ error: 'You cannot grant access to departments outside your scope' });
      }
      if (normalizedAdditionalIds.length) {
        const validDepartments = await prisma.department.findMany({
          where: { id: { in: normalizedAdditionalIds }, workspace: { id: req.user.workspace_id, org_id: req.user.org_id } },
          select: { id: true },
        });
        if (validDepartments.length !== normalizedAdditionalIds.length) {
          return res.status(404).json({ error: 'One or more additional departments were not found' });
        }
      }
    }

    const password_hash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        password_hash,
        role_id: role.id,
        department_id: department.id,
        authorized_departments: {
          create: normalizedAdditionalIds.map((id) => ({ department_id: id })),
        },
      },
      select: {
        id: true,
        email: true,
        role_id: true,
        role: { select: { id: true, name: true } },
        department_id: true,
        authorized_departments: { select: { department_id: true } },
        active: true,
      },
    });

    res.status(201).json({
      user: {
        ...user,
        additional_department_ids: user.authorized_departments.map((grant) => grant.department_id),
        role: role.name,
        role_is_owner: false,
        role_scope: role.scope,
        role_department_id: role.department_id,
      },
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
    const manageableDepartments = manageableDepartmentIds(req.user);
    const where = {
      department: { workspace: { id: req.user.workspace_id, org_id: req.user.org_id } },
      ...(manageableDepartments
        ? { department_id: { in: departmentId
          ? manageableDepartments.filter((id) => id === departmentId)
          : manageableDepartments } }
        : departmentId && { department_id: departmentId }),
      ...(roleId && { role_id: roleId }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          role_id: true,
          role: {
            select: {
              id: true,
              name: true,
              is_owner: true,
              scope: true,
              department_id: true,
              department: { select: { name: true } },
            },
          },
          department_id: true,
          authorized_departments: { select: { department_id: true, department: { select: { name: true } } } },
          active: true,
        },
        orderBy: { email: 'asc' },
        take: limit,
        skip: offset,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      users: users.map(({ role, authorized_departments, ...user }) => ({
        ...user,
        additional_department_ids: (authorized_departments || []).map((grant) => grant.department_id),
        additional_departments: (authorized_departments || []).map((grant) => ({
          id: grant.department_id,
          name: grant.department?.name,
        })),
        role: role.name,
        role_is_owner: role.is_owner,
        role_scope: role.scope,
        role_department_id: role.department_id,
        role_department: role.department?.name ?? null,
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
      data: {
        name: name.trim(),
        org_id: req.user.org_id,
        departments: { create: { name: 'General', is_default: true } },
      },
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

// PATCH /admin/users/:id
async function updateUser(req, res) {
  try {
    const target = await findUserInWorkspace(req.params.id, req.user);
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (await isOrganizationOwner(target.id, req.user.org_id)) {
      return res.status(403).json({ error: 'The organization Owner account cannot be changed here' });
    }

    const { email, role_id: roleId, department_id: departmentId, additional_department_ids: additionalDepartmentIds } = req.body || {};
    const data = {};

    if (email !== undefined) {
      if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      data.email = email.trim().toLowerCase();
    }

    let nextRole = target.role;
    if (roleId !== undefined) {
      if (target.id === req.user.user_id) {
        return res.status(400).json({ error: 'You cannot change your own role' });
      }
      const role = await findAssignableRole(roleId, req.user.org_id);
      if (!role) return res.status(404).json({ error: 'Role not found' });
      nextRole = role;
      if (!permissionsWithinActor(role.permissions, req)) {
        return res.status(403).json({ error: 'You cannot assign a role with permissions you do not have' });
      }
      data.role_id = role.id;
    }

    if (departmentId !== undefined) {
      const dept = await prisma.department.findFirst({
        where: { id: departmentId, workspace: { id: req.user.workspace_id, org_id: req.user.org_id } },
      });
      if (!dept) return res.status(404).json({ error: 'Department not found' });
      const departmentAccessError = validateManagedDepartment(dept.id, req);
      if (departmentAccessError) return res.status(403).json({ error: departmentAccessError });
      data.department_id = departmentId;
      data.authorized_departments = { deleteMany: { department_id: departmentId } };
    }

    const assignmentError = validateRoleAssignment(
      nextRole,
      departmentId !== undefined ? departmentId : target.department_id,
      req
    );
    if (assignmentError) return res.status(403).json({ error: assignmentError });

    if (additionalDepartmentIds !== undefined) {
      if (!Array.isArray(additionalDepartmentIds) || additionalDepartmentIds.some((id) => typeof id !== 'string' || !id)) {
        return res.status(400).json({ error: 'additional_department_ids must be an array of department IDs' });
      }
      const primaryDepartmentId = departmentId !== undefined ? departmentId : target.department_id;
      const normalizedAdditionalIds = [...new Set(additionalDepartmentIds.filter((id) => id !== primaryDepartmentId))];
      const inaccessibleDepartment = normalizedAdditionalIds.find(
        (id) => validateManagedDepartment(id, req)
      );
      if (inaccessibleDepartment) {
        return res.status(403).json({ error: 'You cannot grant access to departments outside your scope' });
      }
      if (normalizedAdditionalIds.length) {
        const validDepartments = await prisma.department.findMany({
          where: { id: { in: normalizedAdditionalIds }, workspace: { id: req.user.workspace_id, org_id: req.user.org_id } },
          select: { id: true },
        });
        if (validDepartments.length !== normalizedAdditionalIds.length) {
          return res.status(404).json({ error: 'One or more additional departments were not found' });
        }
      }
      data.authorized_departments = {
        deleteMany: {},
        create: normalizedAdditionalIds.map((id) => ({ department_id: id })),
      };
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
        role: {
          select: {
            id: true,
            name: true,
            is_owner: true,
            scope: true,
            department_id: true,
            department: { select: { name: true } },
          },
        },
        department_id: true,
        authorized_departments: { select: { department_id: true } },
        active: true,
      },
    });
    res.json({
      user: {
        ...user,
        additional_department_ids: (user.authorized_departments || []).map((grant) => grant.department_id),
        role: user.role.name,
        role_is_owner: user.role.is_owner,
        role_scope: user.role.scope,
        role_department_id: user.role.department_id,
        role_department: user.role.department?.name ?? null,
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
    const target = await findUserInWorkspace(req.params.id, req.user);
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
    const target = await findUserInWorkspace(req.params.id, req.user);
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
      where: {
        department: {
          workspace: { org_id: req.user.org_id },
          ...(manageableDepartmentIds(req.user) && {
            id: { in: manageableDepartmentIds(req.user) },
          }),
        },
      },
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

// GET /admin/departments
async function listDepartments(req, res) {
  try {
    const { workspace_id: workspaceId } = req.query;
    const departmentIds = manageableDepartmentIds(req.user);
    const departments = await prisma.department.findMany({
      where: {
        workspace: { id: req.user.workspace_id, org_id: req.user.org_id },
        ...(departmentIds && { id: { in: departmentIds } }),
        ...(workspaceId && { workspace_id: workspaceId }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        is_default: true,
        workspace_id: true,
        workspace: {
          select: {
            id: true,
            name: true,
            org_id: true,
          },
        },
        _count: {
          select: {
            users: true,
            documents: true,
            authorized_users: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    res.json({ departments });
  } catch (err) {
    console.error('[admin] list departments failed:', err.message);
    res.status(500).json({ error: 'Failed to load departments' });
  }
}

// GET /admin/departments/:id
async function getDepartment(req, res) {
  try {
    const { id: departmentId } = req.params;
    const department = await prisma.department.findFirst({
      where: {
        id: departmentId,
        workspace: { id: req.user.workspace_id, org_id: req.user.org_id },
        ...(manageableDepartmentIds(req.user) && {
          id: { in: manageableDepartmentIds(req.user) },
        }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        is_default: true,
        workspace_id: true,
        workspace: {
          select: {
            id: true,
            name: true,
            org_id: true,
          },
        },
        _count: {
          select: {
            users: true,
            documents: true,
            authorized_users: true,
          },
        },
      },
    });

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    res.json({ department });
  } catch (err) {
    console.error('[admin] get department failed:', err.message);
    res.status(500).json({ error: 'Failed to load department' });
  }
}

// POST /admin/departments
async function createDepartment(req, res) {
  try {
    if (req.user.role_scope === 'department' && !req.user.is_owner) {
      return res.status(403).json({ error: 'Department-scoped roles cannot create departments' });
    }
    const { workspace_id, name, description } = req.body || {};

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Department name is required' });
    }
    if (name.trim().length > 120) {
      return res.status(400).json({ error: 'Department name must be 120 characters or fewer' });
    }

    const targetWorkspaceId = workspace_id || req.user.workspace_id;
    if (targetWorkspaceId !== req.user.workspace_id) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const existing = await prisma.department.findFirst({
      where: {
        name: name.trim(),
        workspace_id: targetWorkspaceId,
      },
    });
    if (existing) {
      return res.status(409).json({ error: 'A department with this name already exists' });
    }

    const department = await prisma.department.create({
      data: {
        name: name.trim(),
        description: typeof description === 'string' && description.trim() ? description.trim() : null,
        workspace_id: targetWorkspaceId,
      },
      select: {
        id: true,
        name: true,
        description: true,
        is_default: true,
        workspace_id: true,
        workspace: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ department });
  } catch (err) {
    console.error('[admin] create department failed:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// PATCH /admin/departments/:id
async function updateDepartment(req, res) {
  try {
    const { id: departmentId } = req.params;
    const { name, description } = req.body || {};

    if (name === undefined && description === undefined) {
      return res.status(400).json({ error: 'Provide a name or description to update' });
    }

    const department = await prisma.department.findFirst({
      where: {
        id: departmentId,
        workspace: { id: req.user.workspace_id, org_id: req.user.org_id },
        ...(manageableDepartmentIds(req.user) && {
          id: { in: manageableDepartmentIds(req.user) },
        }),
      },
      select: { id: true, name: true, is_default: true },
    });

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    const updateData = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Department name is required' });
      }
      if (name.trim().length > 120) {
        return res.status(400).json({ error: 'Department name must be 120 characters or fewer' });
      }
      const duplicate = await prisma.department.findFirst({
        where: {
          name: name.trim(),
          workspace: { id: req.user.workspace_id, org_id: req.user.org_id },
          id: { not: departmentId },
        },
      });
      if (duplicate) {
        return res.status(409).json({ error: 'Another department with this name already exists' });
      }
      updateData.name = name.trim();
    }

    if (description !== undefined) {
      updateData.description = typeof description === 'string' && description.trim() ? description.trim() : null;
    }

    const updatedDept = await prisma.department.update({
      where: { id: departmentId },
      data: updateData,
      select: {
        id: true,
        name: true,
        description: true,
        is_default: true,
        workspace_id: true,
        workspace: { select: { id: true, name: true } },
      },
    });

    res.json({ department: updatedDept });
  } catch (err) {
    console.error('[admin] update department failed:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// DELETE /admin/departments/:id
async function deleteDepartment(req, res) {
  try {
    const { id: departmentId } = req.params;

    const department = await prisma.department.findFirst({
      where: {
        id: departmentId,
        workspace: { id: req.user.workspace_id, org_id: req.user.org_id },
        ...(manageableDepartmentIds(req.user) && {
          id: { in: manageableDepartmentIds(req.user) },
        }),
      },
      select: { id: true, name: true, is_default: true },
    });

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }
    if (department.is_default) {
      return res.status(400).json({
        error: 'The default department cannot be deleted',
        code: 'DEFAULT_DEPARTMENT_PROTECTED',
      });
    }

    const [userCount, documentCount, authorizedUserCount, roleCount] = await Promise.all([
      prisma.user.count({ where: { department_id: departmentId } }),
      prisma.document.count({ where: { department_id: departmentId } }),
      prisma.userAuthorizedDepartment.count({ where: { department_id: departmentId } }),
      prisma.organizationRole.count({ where: { department_id: departmentId } }),
    ]);

    if (userCount > 0 || documentCount > 0 || authorizedUserCount > 0 || roleCount > 0) {
      return res.status(409).json({
        error: "Cannot delete a department with assigned users (" + userCount + "), additional access grants (" + authorizedUserCount + "), roles (" + roleCount + "), or documents (" + documentCount + "). Reassign them first.",
        code: 'DEPARTMENT_HAS_RECORDS',
        userCount,
        documentCount,
        authorizedUserCount,
        roleCount,
      });
    }

    await prisma.department.delete({
      where: { id: departmentId },
    });

    res.json({ message: 'Department deleted successfully', id: departmentId });
  } catch (err) {
    console.error('[admin] delete department failed:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
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
  getDepartment,
  updateDepartment,
  deleteDepartment,
  queryAnalytics,
};
