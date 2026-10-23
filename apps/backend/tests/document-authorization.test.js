const {
  documentAccessWhere,
  qdrantAccessFilter,
  validateAllowedRoleIds,
  getAuthorizedDocumentIds,
} = require('../src/services/documentAuthorization');

const user = {
  org_id: 'org-1',
  workspace_id: 'workspace-1',
  department_id: 'dept-1',
  department_ids: ['dept-1', 'dept-2'],
  authorized_department_ids: ['dept-2'],
  role_id: 'department-role',
  role_scope: 'department',
  role_department_id: 'dept-1',
  is_owner: false,
  permissions: ['documents:search'],
};

describe('document authorization with scoped roles', () => {
  it('requires both an authorized department and an explicit role grant', () => {
    expect(documentAccessWhere(user)).toEqual({
      department: {
        workspace: { id: 'workspace-1', org_id: 'org-1' },
      },
      department_id: { in: ['dept-1', 'dept-2'] },
      allowed_roles: { some: { role_id: 'department-role' } },
    });
  });

  it('applies the same department and role grant filters before Qdrant retrieval', () => {
    expect(qdrantAccessFilter(user)).toEqual({
      must: [
        { key: 'org_id', match: { value: 'org-1' } },
        { key: 'workspace_id', match: { value: 'workspace-1' } },
        { key: 'allowed_role_ids', match: { value: 'department-role' } },
        { key: 'department_id', match: { any: ['dept-1', 'dept-2'] } },
      ],
    });
  });

  it('keeps department-scoped document managers inside their explicit department grants', () => {
    const manager = {
      ...user,
      role_scope: 'department',
      role_department_id: 'dept-1',
      authorized_department_ids: ['dept-2'],
      permissions: ['documents:search', 'documents:manage_access'],
    };

    expect(documentAccessWhere(manager, { manageAccess: true })).toEqual({
      department: {
        workspace: { id: 'workspace-1', org_id: 'org-1' },
      },
      department_id: { in: ['dept-1', 'dept-2'] },
    });
    expect(qdrantAccessFilter(manager, { manageAccess: true }).must).toContainEqual({
      key: 'department_id',
      match: { any: ['dept-1', 'dept-2'] },
    });
  });

  it('rejects a department-scoped manager targeting an ungranted department', async () => {
    const { validateDocumentDepartment } = require('../src/services/documentAuthorization');
    const prisma = {
      department: {
        findFirst: jest.fn().mockResolvedValue({ id: 'dept-3' }),
      },
    };
    const manager = {
      ...user,
      permissions: ['documents:search', 'documents:manage_access'],
    };

    const result = await validateDocumentDepartment(prisma, manager, 'dept-3');

    expect(result).toEqual({
      error: 'You do not have access to that department',
      status: 403,
    });
  });

  it('does not let an organization-wide non-owner role bypass document grants', () => {
    const organizationRoleUser = {
      ...user,
      role_scope: 'organization',
      role_id: 'org-wide-role',
    };

    expect(documentAccessWhere(organizationRoleUser).allowed_roles).toEqual({
      some: { role_id: 'org-wide-role' },
    });
    expect(qdrantAccessFilter(organizationRoleUser).must).toContainEqual({
      key: 'allowed_role_ids',
      match: { value: 'org-wide-role' },
    });
  });

  it('only returns document IDs authorized by the database access filter', async () => {
    const prisma = {
      document: {
        findMany: jest.fn().mockResolvedValue([{ id: 'authorized-doc' }]),
      },
    };

    const ids = await getAuthorizedDocumentIds(
      prisma,
      user,
      ['authorized-doc', 'forbidden-doc', 'authorized-doc']
    );

    expect(ids).toEqual(new Set(['authorized-doc']));
    expect(prisma.document.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['authorized-doc', 'forbidden-doc'] },
        ...documentAccessWhere(user),
      },
      select: { id: true },
    });
  });

  it('rejects role grants from another organization', async () => {
    const prisma = {
      organizationRole: {
        findMany: jest.fn().mockResolvedValue([{ id: user.role_id }]),
      },
    };

    const result = await validateAllowedRoleIds(
      prisma,
      [user.role_id, 'foreign-role'],
      user
    );

    expect(result).toEqual({
      error: 'Every document access role must belong to your organization',
    });
    expect(prisma.organizationRole.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [user.role_id, 'foreign-role'] },
        org_id: 'org-1',
        scope_review_required: false,
        OR: [
          { scope: 'organization' },
          { scope: 'department', department_id: { in: ['dept-1', 'dept-2'] } },
        ],
      },
      select: { id: true },
    });
  });

  it('rejects department-specific roles that do not match the document department', async () => {
    const prisma = {
      organizationRole: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const result = await validateAllowedRoleIds(
      prisma,
      ['hr-role'],
      { ...user, is_owner: true },
      'dept-1'
    );

    expect(result).toEqual({
      error: 'Every document access role must belong to your organization and be valid for the selected department',
    });
    expect(prisma.organizationRole.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['hr-role'] },
        org_id: 'org-1',
        scope_review_required: false,
        OR: [
          { scope: 'organization' },
          { scope: 'department', department_id: 'dept-1' },
        ],
      },
      select: { id: true },
    });
  });
});
