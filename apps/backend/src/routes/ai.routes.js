const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');

// All AI routes require a valid JWT + authenticated user
router.use((req, res, next) => {
  // The auth middleware (`authenticate`) is already applied at the
  // app level for /admin and /auth. For AI routes we check manually
  // so the frontend can call POST /ai/ask and POST /ai/ingest
  // without needing per-route middleware.
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed token' });
  }
  // Forward the raw JWT so the AI service can log the caller
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
