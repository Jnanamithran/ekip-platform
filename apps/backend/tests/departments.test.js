process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockPrisma = {
  user: { findUnique: jest.fn() },
  userAuthorizedDepartment: { count: jest.fn() },
  department: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  workspace: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  document: {
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  organizationRole: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
  },
  integrationToken: {
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

const app = require('../src/app');

const ROLE_OWNER = {
  id: 'role-owner',
  name: 'Owner',
  permissions: [
    'documents:search',
    'documents:upload',
    'documents:delete',
    'departments:manage',
    'workspace:manage',
    'drive:connect',
    'drive:import',
  ],
  is_owner: true,
};

function makeUser({ role = ROLE_OWNER, isOwner = true } = {}) {
  return {
    id: 'user-1',
    email: 'owner@test.com',
    active: true,
    role_id: role.id,
    department_id: 'dept-1',
    role,
    department: {
      name: 'General',
      workspace_id: 'ws-1',
      workspace: {
        org_id: 'org-1',
        organization: { owner_user_id: isOwner ? 'user-1' : 'user-99' },
      },
    },
  };
}

describe('Department management & validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a department with optional description', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());
    mockPrisma.workspace.findFirst.mockResolvedValue({ id: 'ws-1' });
    mockPrisma.department.findFirst.mockResolvedValue(null);
    mockPrisma.department.create.mockResolvedValue({
      id: 'dept-2',
      name: 'Legal',
      description: 'Handles corporate contracts',
      workspace_id: 'ws-1',
      workspace: { id: 'ws-1', name: 'Demo Workspace' },
    });

    const token = jwt.sign({ user_id: 'user-1' }, process.env.JWT_SECRET);
    const res = await request(app)
      .post('/admin/departments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Legal',
        description: 'Handles corporate contracts',
      });

    expect(res.status).toBe(201);
    expect(res.body.department.name).toBe('Legal');
    expect(res.body.department.description).toBe('Handles corporate contracts');
  });

  it('rejects creating a department without a name', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());
    const token = jwt.sign({ user_id: 'user-1' }, process.env.JWT_SECRET);
    const res = await request(app)
      .post('/admin/departments')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'No name' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name is required/i);
  });

  it('lists departments with description and workspace info', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());
    mockPrisma.department.findMany.mockResolvedValue([
      {
        id: 'dept-1',
        name: 'General',
        description: 'Default department',
        workspace_id: 'ws-1',
        workspace: { id: 'ws-1', name: 'Demo Workspace', org_id: 'org-1' },
        _count: { users: 3, documents: 5 },
      },
    ]);

    const token = jwt.sign({ user_id: 'user-1' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/admin/departments')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.departments).toHaveLength(1);
    expect(res.body.departments[0].description).toBe('Default department');
  });

  it('validates department in Google Drive import when invalid department provided', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());
    mockPrisma.department.findMany.mockResolvedValue([]); // department not found in org

    const token = jwt.sign({ user_id: 'user-1' }, process.env.JWT_SECRET);
    const res = await request(app)
      .post('/integrations/google/import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        files: [{ file_id: 'file123' }],
        department_id: 'non-existent-dept',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid department/i);
  });

  it('requires a department for Google Drive imports', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());

    const token = jwt.sign({ user_id: 'user-1' }, process.env.JWT_SECRET);
    const res = await request(app)
      .post('/integrations/google/import')
      .set('Authorization', `Bearer ${token}`)
      .send({ files: [{ file_id: 'file123' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/department is required/i);
  });

  it('prevents deletion of a workspace default department', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());
    mockPrisma.department.findFirst.mockResolvedValue({
      id: 'dept-1',
      name: 'General',
      is_default: true,
    });

    const token = jwt.sign({ user_id: 'user-1' }, process.env.JWT_SECRET);
    const res = await request(app)
      .delete('/admin/departments/dept-1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DEFAULT_DEPARTMENT_PROTECTED');
    expect(mockPrisma.department.delete).not.toHaveBeenCalled();
  });

  it('allows an administrator to rename the workspace default department', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());
    mockPrisma.department.findFirst
      .mockResolvedValueOnce({ id: 'dept-1', name: 'General', is_default: true })
      .mockResolvedValueOnce(null);
    mockPrisma.department.update.mockResolvedValue({
      id: 'dept-1',
      name: 'Company-wide',
      description: null,
      is_default: true,
      workspace_id: 'ws-1',
      workspace: { id: 'ws-1', name: 'Demo Workspace' },
    });

    const token = jwt.sign({ user_id: 'user-1' }, process.env.JWT_SECRET);
    const res = await request(app)
      .patch('/admin/departments/dept-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Company-wide' });

    expect(res.status).toBe(200);
    expect(res.body.department.name).toBe('Company-wide');
  });

  it('blocks deleting a role that still has assignments', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());
    mockPrisma.organizationRole.findFirst.mockResolvedValue({
      id: 'role-member',
      is_owner: false,
      _count: { users: 1, document_access: 0 },
    });

    const token = jwt.sign({ user_id: 'user-1' }, process.env.JWT_SECRET);
    const res = await request(app)
      .delete('/roles/role-member')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.affected_users).toBe(1);
    expect(mockPrisma.organizationRole.delete).not.toHaveBeenCalled();
  });
});
