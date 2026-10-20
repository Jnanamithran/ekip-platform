const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { importLimiter } = require('../middleware/rateLimiter');
const {
  connect, callback, status, listFiles, importFiles, disconnect,
} = require('../controllers/integrations.controller');

const router = express.Router();

// Google sends the browser here with no login token, so this is the ONE
// route that is not behind authenticate. Its identity comes from the signed state.
router.get('/google/callback', callback);

// Everything below needs a login and the Admin or Manager role
router.use(authenticate, requireRole('Admin', 'Manager'));

router.get('/google/connect', connect);
router.get('/google/status', status);
router.get('/google/files', listFiles);
router.post('/google/import', importLimiter,importFiles);
router.delete('/google/disconnect', disconnect);

module.exports = router;