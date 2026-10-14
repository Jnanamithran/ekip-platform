const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate, (req, res, next) => {
  const [, token] = req.headers.authorization.split(' ');
  req.headers['x-ai-token'] = token;
  next();
});

// Query the knowledge base (retrieval + generation + citations)
router.post('/ask', aiController.ask);

// Upload and process a document (ingestion pipeline)
router.post('/ingest', aiController.ingest);

// Health check
router.get('/health', aiController.health);

module.exports = router;
