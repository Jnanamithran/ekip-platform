const express = require('express');
const { createOrganization } = require('../controllers/organization.controller');

const router = express.Router();

// Public on purpose: this is how a new organization signs up
router.post('/', createOrganization);

module.exports = router;
