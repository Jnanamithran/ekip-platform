const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const {
  createUser,
  listUsers,
  createWorkspace,
  listWorkspaces,
  getWorkspaceDashboard,
  updateWorkspace,
  createDepartment,
  listDepartments,
} = require('../controllers/admin.controller');

const router = express.Router();

// Every route in this file needs a valid token AND the Admin role.
router.use(authenticate, requireRole('Admin'));

router.post('/users', createUser);
router.get('/users', listUsers);

router.post('/workspaces', createWorkspace);
router.get('/workspaces', listWorkspaces);
router.get('/workspaces/:workspaceId', getWorkspaceDashboard);
router.patch('/workspaces/:workspaceId', updateWorkspace);

router.post('/departments', createDepartment);
router.get('/departments', listDepartments);

module.exports = router;
    