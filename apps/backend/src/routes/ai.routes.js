const express = require('express');
const router = express.Router();
const multer = require('multer');
const aiController = require('../controllers/ai.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { queryLimiter, uploadLimiter } = require('../middleware/rateLimiter');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.use(authenticate, (req, res, next) => {
  const [, token] = req.headers.authorization.split(' ');
  req.headers['x-ai-token'] = token;
  next();
});

// Query the knowledge base (retrieval + generation + citations)
router.post('/ask', queryLimiter,aiController.ask);
router.post('/ask/progress', aiController.updateAskProgress);
router.get('/ask/progress/:requestId', aiController.getAskProgress);
router.get('/history', aiController.listAnswerHistory);
router.delete('/history', aiController.clearAnswerHistory);

// Upload and process a document (ingestion pipeline)
router.post('/ingest',uploadLimiter, upload.single('file'), aiController.ingest);
router.post(
  '/documents/:id/reindex',
  uploadLimiter,
  requireRole('Admin', 'Manager'),
  aiController.reindexDocument
);
router.post('/documents/:id/progress', aiController.updateDocumentProgress);
router.get('/documents/:id/preview', aiController.previewDocument);

// Rendered page image for a visual citation preview (scanned PDFs, page is 1-based)
router.get(
  '/documents/:id/page-image/:page_num',
  aiController.getDocumentPageImage
);

// List documents available to the authenticated user
router.get('/documents', aiController.listDocuments);

// Delete an authorized document and all of its indexed chunks
router.delete('/documents/:id', aiController.deleteDocument);

// Health check
router.get('/health', aiController.health);

module.exports = router;
