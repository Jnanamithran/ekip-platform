const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { createUser } = require('../controllers/admin.controller');

const router = express.Router();

// Every route in this file needs a valid token AND the Admin role.
// Putting it here means a new admin route can't be left unprotected by mistake.
router.use(authenticate, requireRole('Admin'));

router.post('/users', createUser);

module.exports = router;