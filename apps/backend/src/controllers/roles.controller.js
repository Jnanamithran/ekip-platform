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

async function listRoles(req, res) {
  try {
    const roles = await prisma.organizationRole.findMany({
      where: { org_id: req.user.org_id },
      select: {
        id: true,
        name: true,
        permissions: true,
        is_owner: true,
        _count: { select: { users: true, document_access: true } },
      },
      orderBy: [{ is_owner: 'desc' }, { name: 'asc' }],
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
  const validationError = validateRoleInput(name, permissions);
  if (validationError) return res.status(400).json({ error: validationError });
  if (!canGrantPermissions(req, permissions)) {
    return res.status(403).json({ error: 'You cannot grant permissions that you do not have' });
  }

  try {
    const role = await prisma.organizationRole.create({
      data: { org_id: req.user.org_id, name: name.trim(), permissions },
      select: { id: true, name: true, permissions: true, is_owner: true },
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
  const { name, permissions } = req.body || {};
  if (name === undefined && permissions === undefined) {
    return res.status(400).json({ error: 'Provide a role name or permissions to update' });
  }

  try {
    const role = await prisma.organizationRole.findFirst({
      where: { id: req.params.id, org_id: req.user.org_id },
    });
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_owner) {
      return res.status(403).json({ error: 'The Owner role is protected and cannot be changed' });
    }

    const nextName = name === undefined ? role.name : name;
    const nextPermissions = permissions === undefined ? role.permissions : permissions;
    const validationError = validateRoleInput(nextName, nextPermissions);
    if (validationError) return res.status(400).json({ error: validationError });
    if (!canGrantPermissions(req, nextPermissions)) {
      return res.status(403).json({ error: 'You cannot grant permissions that you do not have' });
    }

    const updated = await prisma.organizationRole.update({
      where: { id: role.id },
      data: { name: nextName.trim(), permissions: nextPermissions },
      select: { id: true, name: true, permissions: true, is_owner: true },
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

module.exports = { listRoles, createRole, updateRole, deleteRole };
