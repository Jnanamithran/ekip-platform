const express = require('express');
const { createOrganization } = require('../controllers/organization.controller');
const { signupLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Public on purpose: this is how a new organization signs up
router.post('/',signupLimiter, createOrganization);

module.exports = router;
