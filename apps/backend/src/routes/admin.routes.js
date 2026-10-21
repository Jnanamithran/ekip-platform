const express = require('express');
const {
  authenticate,
  requirePermission,
  requireAnyPermission,
} = require('../middleware/auth.middleware');
const {
  createUser,
  listUsers,
  updateUser,
  resetPassword,
  deactivateUser,
  reactivateUser,
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
} = require('../controllers/admin.controller');

const router = express.Router();

router.use(authenticate);
router.get('/analytics/queries', requirePermission('analytics:view'), queryAnalytics);
router.post('/users', requirePermission('users:manage'), createUser);
router.get('/users', requirePermission('users:manage'), listUsers);
router.patch('/users/:id', requirePermission('users:manage'), updateUser);
router.post('/users/:id/reset-password', requirePermission('users:manage'), resetPassword);
router.patch('/users/:id/deactivate', requirePermission('users:manage'), deactivateUser);
router.patch('/users/:id/reactivate', requirePermission('users:manage'), reactivateUser);

router.post('/workspaces', requirePermission('workspace:manage'), createWorkspace);
router.get('/workspaces', requirePermission('workspace:manage'), listWorkspaces);
router.get('/workspaces/:workspaceId', requirePermission('workspace:manage'), getWorkspaceDashboard);
router.patch('/workspaces/:workspaceId', requirePermission('workspace:manage'), updateWorkspace);

router.post(
  '/departments',
  requireAnyPermission('departments:manage', 'workspace:manage'),
  createDepartment
);
router.get(
  '/departments/:id',
  requireAnyPermission('departments:manage', 'workspace:manage', 'users:manage'),
  getDepartment
);
router.patch(
  '/departments/:id',
  requireAnyPermission('departments:manage', 'workspace:manage'),
  updateDepartment
);
router.delete(
  '/departments/:id',
  requireAnyPermission('departments:manage', 'workspace:manage'),
  deleteDepartment
);
router.get(
  '/departments',
  requireAnyPermission('departments:manage', 'workspace:manage', 'users:manage'),
  listDepartments
);

module.exports = router;
