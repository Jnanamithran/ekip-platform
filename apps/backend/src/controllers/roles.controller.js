const { PrismaClient } = require('@prisma/client');
const { PERMISSIONS } = require('../utils/permissions');

const prisma = new PrismaClient();
const MAX_ROLE_NAME_LENGTH = 48;

function validateRoleInput(name, permissions) {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.trim().length > MAX_ROLE_NAME_LENGTH ||
    name.trim().toLowerCase() === 'owner'
  ) {
    return 'Role name must be 1-48 characters; Owner is reserved.';
  }
  if (
    !Array.isArray(permissions) ||
    permissions.some((permission) => !PERMISSIONS.includes(permission)) ||
    new Set(permissions).size !== permissions.length
  ) {
    return 'Choose valid, non-duplicate permissions.';
  }
  return null;
}

function canGrantPermissions(req, permissions) {
  return req.user.is_owner ||
    permissions.every((permission) => req.user.permissions.includes(permission));
}

function manageableDepartmentIds(req) {
  if (req.user.is_owner || req.user.role_scope !== 'department') return null;
  return [...new Set([
    req.user.role_department_id,
    ...(req.user.authorized_department_ids || []),
  ].filter(Boolean))];
}

async function validateRoleDepartment(req, scope, departmentId) {
  if (scope === 'organization') {
    if (!req.user.is_owner && req.user.role_scope === 'department') {
      return { error: 'Department-scoped roles cannot create organization-wide roles', status: 403 };
    }
    return departmentId == null
      ? { departmentId: null }
      : { error: 'Organization-wide roles cannot have a department', status: 400 };
  }
  if (scope !== 'department' || typeof departmentId !== 'string' || !departmentId) {
    return { error: 'Department-scoped roles require a department', status: 400 };
  }
  if (
    !req.user.is_owner &&
    (
      !req.user.permissions.includes('departments:manage') ||
      !(req.user.department_ids || [req.user.department_id]).includes(departmentId)
    )
  ) {
    return { error: 'You need department-management access to that department', status: 403 };
  }
  const department = await prisma.department.findFirst({
    where: {
      id: departmentId,
      workspace: { id: req.user.workspace_id, org_id: req.user.org_id },
    },
    select: { id: true },
  });
  if (!department) return { error: 'Department not found', status: 404 };
  return { departmentId: department.id };
}

async function listRoles(req, res) {
  try {
    const accessibleDepartments = manageableDepartmentIds(req);
    const roles = await prisma.organizationRole.findMany({
      where: {
        org_id: req.user.org_id,
        ...(accessibleDepartments && {
          OR: [
            { scope: 'organization' },
            { scope: 'department', department_id: { in: accessibleDepartments } },
          ],
        }),
      },
      select: {
        id: true,
        name: true,
        permissions: true,
        is_owner: true,
        scope: true,
        department_id: true,
        scope_review_required: true,
        department: { select: { name: true } },
        _count: { select: { users: true, document_access: true } },
      },
      orderBy: [{ is_owner: 'desc' }, { scope: 'asc' }, { name: 'asc' }],
    });
    res.json({
      roles: roles.map(({ _count, ...role }) => ({
        ...role,
        member_count: _count.users,
        document_count: _count.document_access,
      })),
      permissions: PERMISSIONS,
    });
  } catch (err) {
    console.error('[roles] list failed:', err.message);
    res.status(500).json({ error: 'Could not load organization roles' });
  }
}

async function createRole(req, res) {
  const { name, permissions } = req.body || {};
  const scope = req.body?.scope ?? 'organization';
  const departmentId = req.body?.department_id ?? null;
  const validationError = validateRoleInput(name, permissions);
  if (validationError) return res.status(400).json({ error: validationError });
  if (!canGrantPermissions(req, permissions)) {
    return res.status(403).json({ error: 'You cannot grant permissions that you do not have' });
  }

  try {
    const scopeResult = await validateRoleDepartment(req, scope, departmentId);
    if (scopeResult.error) {
      return res.status(scopeResult.status).json({ error: scopeResult.error });
    }
    const role = await prisma.organizationRole.create({
      data: {
        org_id: req.user.org_id,
        name: name.trim(),
        permissions,
        scope,
        department_id: scopeResult.departmentId,
      },
      select: {
        id: true, name: true, permissions: true, is_owner: true, scope: true,
        department_id: true, department: { select: { name: true } },
      },
    });
    res.status(201).json({ role });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A role with that name already exists' });
    }
    console.error('[roles] create failed:', err.message);
    res.status(500).json({ error: 'Could not create role' });
  }
}

async function updateRole(req, res) {
  const { name, permissions, scope, department_id: requestedDepartmentId } = req.body || {};
  if (name === undefined && permissions === undefined && scope === undefined && requestedDepartmentId === undefined) {
    return res.status(400).json({ error: 'Provide role details to update' });
  }

  try {
    const role = await prisma.organizationRole.findFirst({
      where: { id: req.params.id, org_id: req.user.org_id },
    });
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_owner) {
      return res.status(403).json({ error: 'The Owner role is protected and cannot be changed' });
    }
    if (role.scope_review_required && (!req.user.is_owner || scope === undefined)) {
      return res.status(403).json({
        error: 'Only the organization Owner can explicitly resolve this role’s scope',
      });
    }
    const accessibleDepartments = manageableDepartmentIds(req);
    if (role.scope === 'organization' && req.user.role_scope === 'department' && !req.user.is_owner) {
      return res.status(403).json({ error: 'Department-scoped roles cannot manage organization-wide roles' });
    }
    if (
      role.scope === 'department' &&
      (
        !req.user.permissions.includes('departments:manage') ||
        (accessibleDepartments && !accessibleDepartments.includes(role.department_id))
      )
    ) {
      return res.status(403).json({ error: 'You cannot manage roles outside your department scope' });
    }

    const nextName = name === undefined ? role.name : name;
    const nextPermissions = permissions === undefined ? role.permissions : permissions;
    const nextScope = scope === undefined ? role.scope : scope;
    const nextDepartmentId = requestedDepartmentId === undefined
      ? (scope === 'organization' ? null : role.department_id)
      : requestedDepartmentId;
    const validationError = validateRoleInput(nextName, nextPermissions);
    if (validationError) return res.status(400).json({ error: validationError });
    if (!canGrantPermissions(req, nextPermissions)) {
      return res.status(403).json({ error: 'You cannot grant permissions that you do not have' });
    }
    const scopeResult = await validateRoleDepartment(req, nextScope, nextDepartmentId);
    if (scopeResult.error) {
      return res.status(scopeResult.status).json({ error: scopeResult.error });
    }
    if (
      role.scope_review_required ||
      role.scope !== nextScope ||
      role.department_id !== scopeResult.departmentId
    ) {
      const [userCount, documentAccessCount] = await Promise.all([
        prisma.user.count({ where: { role_id: role.id } }),
        prisma.documentRoleAccess.count({ where: { role_id: role.id } }),
      ]);
      if (userCount || documentAccessCount) {
        return res.status(409).json({
          error: 'Reassign users and document access before changing a role’s scope or department',
          affected_users: userCount,
          affected_documents: documentAccessCount,
        });
      }
    }

    const updated = await prisma.organizationRole.update({
      where: { id: role.id },
      data: {
        name: nextName.trim(),
        permissions: nextPermissions,
        scope: nextScope,
        department_id: scopeResult.departmentId,
        ...(role.scope_review_required && { scope_review_required: false }),
      },
      select: {
        id: true, name: true, permissions: true, is_owner: true, scope: true,
        department_id: true, department: { select: { name: true } },
      },
    });
    res.json({ role: updated });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A role with that name already exists' });
    }
    console.error('[roles] update failed:', err.message);
    res.status(500).json({ error: 'Could not update role' });
  }
}

async function deleteRole(req, res) {
  try {
    // Only the organization Owner can delete roles
    if (!req.user.is_owner) {
      return res.status(403).json({ error: 'Only the organization Owner can delete roles' });
    }

    const role = await prisma.organizationRole.findFirst({
      where: { id: req.params.id, org_id: req.user.org_id },
      select: {
        id: true,
        is_owner: true,
        scope: true,
        department_id: true,
        scope_review_required: true,
        _count: { select: { users: true, document_access: true } },
      },
    });
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_owner) {
      return res.status(403).json({ error: 'The Owner role cannot be deleted' });
    }

    if (role._count.users || role._count.document_access) {
      return res.status(409).json({
        error: 'Reassign all users and document permissions before deleting this role',
        affected_users: role._count.users,
        affected_documents: role._count.document_access,
      });
    }

    await prisma.organizationRole.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[roles] delete failed:', err.message);
    res.status(500).json({ error: 'Could not delete role' });
  }
}

module.exports = {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  validateRoleDepartment,
};
