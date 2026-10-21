const express = require('express');
const router = express.Router();
const multer = require('multer');
const aiController = require('../controllers/ai.controller');
const {
  authenticate,
  requirePermission,
  requireAnyPermission,
} = require('../middleware/auth.middleware');
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
router.post('/ask', requirePermission('documents:search'), queryLimiter, aiController.ask);
router.post('/ask/progress', requirePermission('documents:search'), aiController.updateAskProgress);
router.get('/ask/progress/:requestId', requirePermission('documents:search'), aiController.getAskProgress);
router.get('/history', requirePermission('documents:search'), aiController.listAnswerHistory);
router.delete('/history', requirePermission('documents:search'), aiController.clearAnswerHistory);

// Upload and process a document (ingestion pipeline)
router.post(
  '/ingest',
  requirePermission('documents:upload'),
  uploadLimiter,
  upload.single('file'),
  aiController.ingest
);
router.post(
  '/documents/:id/reindex',
  uploadLimiter,
  requirePermission('documents:reindex'),
  aiController.reindexDocument
);
router.post(
  '/documents/:id/progress',
  requireAnyPermission('documents:upload', 'drive:import', 'documents:reindex'),
  aiController.updateDocumentProgress
);
router.get(
  '/documents/:id/preview',
  requirePermission('documents:search'),
  aiController.previewDocument
);
router.patch(
  '/documents/:id/access',
  requirePermission('documents:manage_access'),
  aiController.updateDocumentAccess
);

// Rendered page image for a visual citation preview (scanned PDFs, page is 1-based)
router.get(
  '/documents/:id/page-image/:page_num',
  requirePermission('documents:search'),
  aiController.getDocumentPageImage
);

// List documents available to the authenticated user
router.get(
  '/documents',
  requireAnyPermission(
    'documents:search',
    'documents:upload',
    'documents:delete',
    'documents:reindex',
    'documents:manage_access'
  ),
  aiController.listDocuments
);

// Delete an authorized document and all of its indexed chunks
router.delete(
  '/documents/:id',
  requirePermission('documents:delete'),
  aiController.deleteDocument
);

// Health check
router.get('/health', aiController.health);

module.exports = router;
