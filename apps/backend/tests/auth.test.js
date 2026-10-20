process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const mockPrisma = {
  user: { findUnique: jest.fn() },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
};
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

const app = require('../src/app');

const payload = {
  user_id: 'user-1',
  org_id: 'org-1',
  workspace_id: 'ws-1',
  department_id: 'dept-1',
  role: 'Manager',
};
const sign = (data, options) => jwt.sign(data, process.env.JWT_SECRET, options);

beforeEach(() => {
  mockPrisma.user.findUnique.mockReset();
});

describe('Auth middleware', () => {
  test('valid token -> 200 on /auth/me', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@test.com',
      role: 'Manager',
      department_id: 'dept-1',
      department: {
        name: 'Engineering',
        workspace_id: 'ws-1',
        workspace: { org_id: 'org-1' },
      },
    });
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${sign(payload)}`);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('Manager');
  });

  test('missing token -> 401', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  test('expired token -> 401', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${sign(payload, { expiresIn: '-1s' })}`);
    expect(res.status).toBe(401);
  });

  test('tampered token -> 401', async () => {
    const tampered = sign(payload).slice(0, -5) + 'XXXXX';
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  test('Intern -> 403 on admin route', async () => {
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${sign({ ...payload, role: 'Intern' })}`);
    expect(res.status).toBe(403);
  });

  test('Manager -> 403 on admin route', async () => {
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${sign(payload)}`);
    expect(res.status).toBe(403);
  });
});

describe('Login protection', () => {
  test('deactivated account -> 403 ACCOUNT_DEACTIVATED', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'off@test.com',
      password_hash: bcrypt.hashSync('Password1!', 4),
      active: false,
    });
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'off@test.com', password: 'Password1!' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_DEACTIVATED');
  });

  test('5 failed logins -> 6th attempt is rate limited (429)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'locked@test.com', password: 'wrong' });
      expect(res.status).toBe(401);
    }
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'locked@test.com', password: 'wrong' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });
});