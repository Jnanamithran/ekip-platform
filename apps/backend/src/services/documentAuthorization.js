function documentAccessWhere(user, { manageAccess = false } = {}) {
  const canManageAccess =
    manageAccess &&
    (user.is_owner || user.permissions.includes('documents:manage_access'));
  const scopedDepartments = user.role_scope === 'department'
    ? [...new Set([
        user.role_department_id,
        ...(user.authorized_department_ids || []),
      ].filter(Boolean))]
    : null;
  const allowedDepartments = scopedDepartments ||
    user.department_ids ||
    [user.department_id];

  return {
    department: {
      workspace: { id: user.workspace_id, org_id: user.org_id },
    },
    ...(!user.is_owner && !canManageAccess && {
      department_id: { in: allowedDepartments },
      allowed_roles: { some: { role_id: user.role_id } },
    }),
    ...(!user.is_owner && canManageAccess && scopedDepartments && {
      department_id: { in: scopedDepartments },
    }),
  };
}

function qdrantAccessFilter(user, { manageAccess = false } = {}) {
  const must = [
    { key: 'org_id', match: { value: user.org_id } },
    { key: 'workspace_id', match: { value: user.workspace_id } },
  ];
  const canManageAccess =
    manageAccess &&
    (user.is_owner || user.permissions.includes('documents:manage_access'));
  const scopedDepartments = user.role_scope === 'department'
    ? [...new Set([
        user.role_department_id,
        ...(user.authorized_department_ids || []),
      ].filter(Boolean))]
    : null;
  const allowedDepartments = scopedDepartments ||
    user.department_ids ||
    [user.department_id];

  if (!user.is_owner && !canManageAccess) {
    must.push({ key: 'allowed_role_ids', match: { value: user.role_id } });
    must.push({ key: 'department_id', match: { any: allowedDepartments } });
  } else if (!user.is_owner && canManageAccess && scopedDepartments) {
    must.push({ key: 'department_id', match: { any: scopedDepartments } });
  }
  return { must };
}

async function validateDocumentDepartment(prisma, user, departmentId) {
  if (typeof departmentId !== 'string' || !departmentId.trim()) {
    return { error: 'department_id is required', status: 400 };
  }

  const normalizedId = departmentId.trim();
  const department = await prisma.department.findFirst({
    where: {
      id: normalizedId,
      workspace: { id: user.workspace_id, org_id: user.org_id },
    },
    select: { id: true },
  });
  if (!department) {
    return { error: 'Invalid department specified', status: 400 };
  }

  const canManageAccess =
    user.is_owner || user.permissions.includes('documents:manage_access');
  const scopedDepartments = user.role_scope === 'department'
    ? [...new Set([
        user.role_department_id,
        ...(user.authorized_department_ids || []),
      ].filter(Boolean))]
    : null;
  if (
    (scopedDepartments && !scopedDepartments.includes(department.id)) ||
    (!canManageAccess &&
      !(user.department_ids || [user.department_id]).includes(department.id))
  ) {
    return { error: 'You do not have access to that department', status: 403 };
  }

  return { departmentId: department.id };
}

async function validateAllowedRoleIds(prisma, allowedRoleIds, user, departmentId) {
  if (
    !Array.isArray(allowedRoleIds) ||
    !allowedRoleIds.length ||
    allowedRoleIds.some((id) => typeof id !== 'string' || !id) ||
    new Set(allowedRoleIds).size !== allowedRoleIds.length
  ) {
    return { error: 'allowed_role_ids must be a non-empty list of role IDs' };
  }

  const roleScopeFilter = departmentId
    ? {
        OR: [
          { scope: 'organization' },
          { scope: 'department', department_id: departmentId },
        ],
      }
    : user.role_scope === 'department'
      ? {
          OR: [
            { scope: 'organization' },
            {
              scope: 'department',
              department_id: {
                in: [...new Set([
                  user.role_department_id,
                  ...(user.authorized_department_ids || []),
                ].filter(Boolean))],
              },
            },
          ],
        }
      : {};
  const roles = await prisma.organizationRole.findMany({
    where: {
      id: { in: allowedRoleIds },
      org_id: user.org_id,
      scope_review_required: false,
      ...roleScopeFilter,
    },
    select: { id: true },
  });
  if (roles.length !== allowedRoleIds.length) {
    return {
      error: departmentId
        ? 'Every document access role must belong to your organization and be valid for the selected department'
        : 'Every document access role must belong to your organization',
    };
  }
  if (!user.is_owner && !allowedRoleIds.includes(user.role_id)) {
    return { error: 'Document access must include your own role' };
  }
  if (
    !user.is_owner &&
    !user.permissions.includes('documents:manage_access') &&
    (allowedRoleIds.length !== 1 || allowedRoleIds[0] !== user.role_id)
  ) {
    return { error: 'You do not have permission to assign document access roles' };
  }
  return { roleIds: allowedRoleIds };
}

async function getAuthorizedDocumentIds(prisma, user, documentIds) {
  const ids = [...new Set(documentIds.filter((id) => typeof id === 'string' && id))];
  if (!ids.length) return new Set();

  const documents = await prisma.document.findMany({
    where: {
      id: { in: ids },
      ...documentAccessWhere(user),
    },
    select: { id: true },
  });
  return new Set(documents.map((document) => document.id));
}

module.exports = {
  documentAccessWhere,
  qdrantAccessFilter,
  validateDocumentDepartment,
  validateAllowedRoleIds,
  getAuthorizedDocumentIds,
};
