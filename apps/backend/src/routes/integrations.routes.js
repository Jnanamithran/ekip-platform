const express = require('express');
const {
  authenticate,
  requirePermission,
  requireAnyPermission,
} = require('../middleware/auth.middleware');
const { importLimiter } = require('../middleware/rateLimiter');
const {
  connect, callback, status, listFolders, listFiles, importFiles, disconnect,
} = require('../controllers/integrations.controller');

const router = express.Router();

// Google sends the browser here with no login token, so this is the ONE
// route that is not behind authenticate. Its identity comes from the signed state.
router.get('/google/callback', callback);

router.use(authenticate);

router.get('/google/connect', requirePermission('drive:connect'), connect);
router.get('/google/status', requireAnyPermission('drive:connect', 'drive:import'), status);
router.get('/google/folders', requirePermission('drive:import'), listFolders);
router.get('/google/files', requirePermission('drive:import'), listFiles);
router.post('/google/import', requirePermission('drive:import'), importLimiter, importFiles);
router.delete(
  '/google/disconnect',
  requireAnyPermission('drive:connect', 'drive:import'),
  disconnect
);

module.exports = router;