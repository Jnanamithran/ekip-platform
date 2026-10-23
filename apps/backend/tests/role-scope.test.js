process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  department: {
    findFirst: jest.fn(),
  },
  organizationRole: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  documentRoleAccess: {
    count: jest.fn(),
  },
  organization: {
    findFirst: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

const app = require('../src/app');

const DEPARTMENT_IDS = ['dept-1', 'dept-2'];
const PERMISSIONS = [
  'roles:manage',
  'users:manage',
  'departments:manage',
  'documents:search',
];

function makeAuthUser() {
  return {
    id: 'user-1',
    email: 'admin@test.com',
    active: true,
    role_id: 'role-admin',
    department_id: 'dept-1',
    role: {
      id: 'role-admin',
      name: 'Admin',
      permissions: PERMISSIONS,
      is_owner: false,
      scope: 'organization',
      department_id: null,
      scope_review_required: false,
    },
    department: {
      name: 'Finance',
      workspace_id: 'workspace-1',
      workspace: {
        org_id: 'org-1',
        organization: { owner_user_id: 'another-user' },
      },
    },
    authorized_departments: DEPARTMENT_IDS.slice(1).map((id) => ({
      department: {
        id,
        workspace_id: 'workspace-1',
        workspace: { org_id: 'org-1' },
      },
    })),
  };
}

function authHeaders() {
  const token = jwt.sign({ user_id: 'user-1' }, process.env.JWT_SECRET);
  return { Authorization: `Bearer ${token}` };
}

describe('department-scoped roles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(makeAuthUser());
  });

  it('creates department roles with the selected department scope', async () => {
    mockPrisma.department.findFirst.mockResolvedValue({ id: 'dept-1' });
    mockPrisma.organizationRole.create.mockResolvedValue({
      id: 'role-finance',
      name: 'Analyst',
      permissions: ['documents:search'],
      is_owner: false,
      scope: 'department',
      department_id: 'dept-1',
    });

    const response = await request(app)
      .post('/roles')
      .set(authHeaders())
      .send({
        name: 'Analyst',
        permissions: ['documents:search'],
        scope: 'department',
        department_id: 'dept-1',
      });

    expect(response.status).toBe(201);
    expect(mockPrisma.organizationRole.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org-1',
          scope: 'department',
          department_id: 'dept-1',
        }),
      })
    );
  });

  it('rejects department-scoped roles without a department', async () => {
    const response = await request(app)
      .post('/roles')
      .set(authHeaders())
      .send({
        name: 'Analyst',
        permissions: [],
        scope: 'department',
      });

    expect(response.status).toBe(400);
    expect(mockPrisma.organizationRole.create).not.toHaveBeenCalled();
  });

  it('requires department-management permission to create a department role', async () => {
    const authUser = makeAuthUser();
    authUser.role.permissions = authUser.role.permissions.filter(
      (permission) => permission !== 'departments:manage'
    );
    mockPrisma.user.findUnique.mockResolvedValue(authUser);

    const response = await request(app)
      .post('/roles')
      .set(authHeaders())
      .send({
        name: 'Analyst',
        permissions: [],
        scope: 'department',
        department_id: 'dept-1',
      });

    expect(response.status).toBe(403);
    expect(mockPrisma.organizationRole.create).not.toHaveBeenCalled();
  });

  it('rejects a department outside the caller workspace', async () => {
    const authUser = makeAuthUser();
    authUser.department.workspace.organization.owner_user_id = 'user-1';
    authUser.role.is_owner = true;
    mockPrisma.user.findUnique.mockResolvedValue(authUser);
    mockPrisma.department.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .post('/roles')
      .set(authHeaders())
      .send({
        name: 'Analyst',
        permissions: [],
        scope: 'department',
        department_id: 'foreign-dept',
      });

    expect(response.status).toBe(404);
    expect(mockPrisma.department.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'foreign-dept',
        workspace: { id: 'workspace-1', org_id: 'org-1' },
      },
      select: { id: true },
    });
  });

  it('prevents a department role from editing a role in an unauthorized department', async () => {
    const authUser = makeAuthUser();
    authUser.role.scope = 'department';
    authUser.role.department_id = 'dept-1';
    authUser.authorized_departments = [];
    mockPrisma.user.findUnique.mockResolvedValue(authUser);
    mockPrisma.organizationRole.findFirst.mockResolvedValue({
      id: 'role-hr',
      org_id: 'org-1',
      name: 'HR Admin',
      permissions: [],
      is_owner: false,
      scope: 'department',
      department_id: 'dept-2',
    });

    const response = await request(app)
      .patch('/roles/role-hr')
      .set(authHeaders())
      .send({ permissions: [] });

    expect(response.status).toBe(403);
    expect(mockPrisma.user.count).not.toHaveBeenCalled();
    expect(mockPrisma.organizationRole.update).not.toHaveBeenCalled();
  });

  it('does not allow a custom role to use the reserved Owner name', async () => {
    const response = await request(app)
      .post('/roles')
      .set(authHeaders())
      .send({ name: 'Owner', permissions: [] });

    expect(response.status).toBe(400);
    expect(mockPrisma.organizationRole.create).not.toHaveBeenCalled();
  });

  it('blocks authentication for a quarantined legacy role', async () => {
    const authUser = makeAuthUser();
    authUser.role.scope_review_required = true;
    mockPrisma.user.findUnique.mockResolvedValue(authUser);

    const response = await request(app)
      .get('/roles')
      .set(authHeaders());

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ROLE_SCOPE_REVIEW_REQUIRED');
  });

  it('does not assign a quarantined role to a new user', async () => {
    mockPrisma.department.findFirst.mockResolvedValue({ id: 'dept-1' });
    mockPrisma.organizationRole.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .post('/admin/users')
      .set(authHeaders())
      .send({
        email: 'new-user@test.com',
        password: 'StrongPass123',
        role_id: 'legacy-role',
        department_id: 'dept-1',
      });

    expect(response.status).toBe(404);
    expect(mockPrisma.organizationRole.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ scope_review_required: false }),
      })
    );
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('allows only an Owner to explicitly resolve a quarantined role', async () => {
    const owner = makeAuthUser();
    owner.department.workspace.organization.owner_user_id = 'user-1';
    mockPrisma.user.findUnique.mockResolvedValue(owner);
    mockPrisma.organizationRole.findFirst.mockResolvedValue({
      id: 'legacy-role',
      org_id: 'org-1',
      name: 'Legacy Analyst - Finance (12345678)',
      permissions: [],
      is_owner: false,
      scope: 'organization',
      department_id: null,
      scope_review_required: true,
    });
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.documentRoleAccess.count.mockResolvedValue(0);
    mockPrisma.organizationRole.update.mockResolvedValue({
      id: 'legacy-role',
      name: 'Legacy Analyst - Finance (12345678)',
      permissions: [],
      is_owner: false,
      scope: 'organization',
      department_id: null,
      department: null,
    });

    const response = await request(app)
      .patch('/roles/legacy-role')
      .set(authHeaders())
      .send({
        name: 'Finance Analyst',
        permissions: [],
        scope: 'organization',
        department_id: null,
      });

    expect(response.status).toBe(200);
    expect(mockPrisma.organizationRole.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scope_review_required: false,
          scope: 'organization',
          department_id: null,
        }),
      })
    );
  });

  it('rejects assigning a department role outside its department', async () => {
    mockPrisma.department.findFirst.mockResolvedValue({ id: 'dept-1' });
    mockPrisma.organizationRole.findFirst.mockResolvedValue({
      id: 'role-hr-admin',
      name: 'HR Admin',
      permissions: [],
      scope: 'department',
      department_id: 'dept-2',
    });

    const response = await request(app)
      .post('/admin/users')
      .set(authHeaders())
      .send({
        email: 'new-user@test.com',
        password: 'StrongPass123',
        role_id: 'role-hr-admin',
        department_id: 'dept-1',
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/only be assigned/i);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('allows assigning a department role to a user in that department', async () => {
    mockPrisma.department.findFirst.mockResolvedValue({ id: 'dept-1' });
    mockPrisma.organizationRole.findFirst.mockResolvedValue({
      id: 'role-finance',
      name: 'Finance Analyst',
      permissions: ['documents:search'],
      scope: 'department',
      department_id: 'dept-1',
    });
    mockPrisma.user.create.mockResolvedValue({
      id: 'new-user',
      email: 'analyst@test.com',
      role_id: 'role-finance',
      department_id: 'dept-1',
      authorized_departments: [],
    });

    const response = await request(app)
      .post('/admin/users')
      .set(authHeaders())
      .send({
        email: 'analyst@test.com',
        password: 'StrongPass123',
        role_id: 'role-finance',
        department_id: 'dept-1',
      });

    expect(response.status).toBe(201);
    expect(response.body.user.role_scope).toBe('department');
  });

  it('prevents changing a role scope while users are assigned', async () => {
    mockPrisma.organizationRole.findFirst.mockResolvedValue({
      id: 'role-finance',
      org_id: 'org-1',
      name: 'Analyst',
      permissions: [],
      is_owner: false,
      scope: 'department',
      department_id: 'dept-1',
    });
    mockPrisma.department.findFirst.mockResolvedValue({ id: 'dept-2' });
    mockPrisma.user.count.mockResolvedValue(1);
    mockPrisma.documentRoleAccess.count.mockResolvedValue(0);

    const response = await request(app)
      .patch('/roles/role-finance')
      .set(authHeaders())
      .send({ department_id: 'dept-2' });

    expect(response.status).toBe(409);
    expect(mockPrisma.organizationRole.update).not.toHaveBeenCalled();
  });
});
