const express = require('express');
const {
  authenticate,
  requirePermission,
  requireAnyPermission,
} = require('../middleware/auth.middleware');
const {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
} = require('../controllers/roles.controller');

const router = express.Router();

router.use(authenticate);
router.get(
  '/',
  requireAnyPermission('roles:manage', 'documents:manage_access', 'users:manage'),
  listRoles
);
router.post('/', requirePermission('roles:manage'), createRole);
router.patch('/:id', requirePermission('roles:manage'), updateRole);
router.delete('/:id', requirePermission('roles:manage'), deleteRole);

module.exports = router;
