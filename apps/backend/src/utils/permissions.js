const PERMISSIONS = Object.freeze([
  'documents:search',
  'documents:upload',
  'documents:delete',
  'documents:reindex',
  'documents:manage_access',
  'drive:connect',
  'drive:import',
  'users:manage',
  'roles:manage',
  'workspace:manage',
  'analytics:view',
]);

const OWNER_PERMISSIONS = PERMISSIONS;

module.exports = { PERMISSIONS, OWNER_PERMISSIONS };
