const axios = require('axios');
const FORM_DATA = require('form-data');
const path = require('path');
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

// AI service base URL (set via env in Docker; default to localhost for dev)
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const prisma = new PrismaClient();

// Build the RBAC payload extracted from the verified JWT token.
// The AI service trusts this because it comes from the backend.
function rbacFromReq(req) {
  return {
    org_id       : req.user.org_id,
    workspace_id : req.user.workspace_id,
    department_id: req.user.department_id,
    role         : req.user.role,
  };
}

// --- Health check ---

async function health(req, res) {
  try {
    const resp = await axios.get(`${AI_SERVICE_URL}/health`);
    res.json(resp.data);
  } catch (err) {
    console.error('[ai] health check failed:', err.message);
    res.status(503).json({ error: 'AI service unavailable', details: err.message });
  }
}

// --- Ask a question (full RAG pipeline) ---

async function ask(req, res) {
  try {
    const rbac = rbacFromReq(req);
    const url = `${AI_SERVICE_URL}/ask`;
    const requestId = req.body.request_id;
    if (typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId)) {
      return res.status(400).json({ error: 'A valid request_id is required' });
    }
    await prisma.aiRequestProgress.deleteMany({
      where: { created_at: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    await prisma.aiRequestProgress.create({
      data: {
        request_id: requestId,
        user_id: req.user.user_id,
        stage: 'Starting your search',
      },
    });

    const payload = {
      query: req.body.query,
      rbac,
      token: req.headers['x-ai-token'] || '',
      request_id: requestId,
    };

    const resp = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
    });

    // Transform the AI service's citation shape to match the frontend contract
    const sources = resp.data.sources.map((s) => ({
      id: s.id,
      filename: s.filename,
      page: s.page,
      excerpt: s.excerpt,
    }));
    const sourceDocumentCount = new Set(sources.map((source) => source.filename)).size;

    res.json({
      answer: resp.data.answer,
      sources,
      model: resp.data.model,
      has_answer: resp.data.has_answer,
      answer_summary: sources.length
        ? `This answer is based on ${sources.length} cited passage${sources.length === 1 ? '' : 's'} from ${sourceDocumentCount} document${sourceDocumentCount === 1 ? '' : 's'}.`
        : 'No supporting passages were found in the documents available to you.',
    });
  } catch (err) {
    console.error('[ai] /ask failed:', err.message);
    if (err.response) {
      res.status(err.response.status).json({ error: err.response.data });
    } else {
      res.status(500).json({ error: 'Failed to reach AI service' });
    }
  }
}

async function updateAskProgress(req, res) {
  const { request_id: requestId, stage } = req.body;
  if (typeof requestId !== 'string' || typeof stage !== 'string' || stage.length > 120) {
    return res.status(400).json({ error: 'A valid request_id and stage are required' });
  }

  try {
    const result = await prisma.aiRequestProgress.updateMany({
      where: { request_id: requestId, user_id: req.user.user_id },
      data: { stage },
    });
    if (!result.count) {
      return res.status(404).json({ error: 'Search request not found' });
    }
    res.json({ updated: true });
  } catch (err) {
    console.error('[ai] search progress update failed:', err.message);
    res.status(500).json({ error: 'Failed to update search progress' });
  }
}

async function getAskProgress(req, res) {
  try {
    const progress = await prisma.aiRequestProgress.findFirst({
      where: {
        request_id: req.params.requestId,
        user_id: req.user.user_id,
      },
      select: { stage: true },
    });
    res.json({ stage: progress?.stage || 'Starting your search' });
  } catch (err) {
    console.error('[ai] search progress lookup failed:', err.message);
    res.status(500).json({ error: 'Failed to load search progress' });
  }
}

// --- Ingest a document ---

async function ingest(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'A document file is required' });
  }

  const documentId = randomUUID();
  let documentCreated = false;

  try {
    const filename = path.basename(req.file.originalname);
    const fileType = path.extname(filename).slice(1).toLowerCase();
    await prisma.document.create({
      data: {
        id: documentId,
        department_id: req.user.department_id,
        filename,
        file_type: fileType,
        status: 'Processing',
        stage: 'File received',
        progress: 5,
        uploaded_by: req.user.user_id,
        allowed_roles: [req.user.role],
      },
    });
    documentCreated = true;

    // Build FormData for multipart upload
    const form = new FORM_DATA();
    form.append('rbac', JSON.stringify(rbacFromReq(req)));
    form.append('token', req.headers['x-ai-token'] || '');
    form.append('document_id', documentId);
    form.append('file', req.file.buffer, {
      filename,
      contentType: req.file.mimetype,
    });

    const resp = await axios.post(`${AI_SERVICE_URL}/ingest`, form, {
      headers: {
        ...form.getHeaders(),
      },
      timeout: 10 * 60 * 1000,
    });

    const document = await prisma.document.update({
      where: { id: documentId },
      data: {
        status: resp.data.status || 'Indexed',
        stage: 'Complete',
        progress: 100,
        chunk_count: resp.data.chunk_count || 0,
      },
    });

    res.json({ ...resp.data, document_id: document.id });
  } catch (err) {
    console.error('[ai] /ingest failed:', err.message);
    if (documentCreated) {
      try {
        await prisma.document.update({
          where: { id: documentId },
          data: {
            status: err.code === 'ECONNABORTED' ? 'Timed out' : 'Failed',
            stage: err.code === 'ECONNABORTED' ? 'Processing timed out' : 'Processing failed',
          },
        });
      } catch (updateError) {
        console.error('[ai] failed to record document upload failure:', updateError.message);
      }
    }
    if (err.response) {
      res.status(err.response.status).json({
        error: err.response.data?.detail || 'AI service rejected the document',
      });
    } else if (err.code === 'ECONNABORTED') {
      res.status(504).json({ error: 'Document processing timed out; check its status before retrying' });
    } else {
      res.status(500).json({ error: 'Failed to reach AI service' });
    }
  }
}

async function listDocuments(req, res) {
  try {
    const savedDocuments = await prisma.document.findMany({
      where: {
        department_id: req.user.department_id,
        allowed_roles: { has: req.user.role },
      },
      select: {
        id: true,
        filename: true,
        file_type: true,
        status: true,
        stage: true,
        progress: true,
        chunk_count: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    try {
      const indexedDocuments = new Map();
      let offset;

      do {
        const response = await axios.post(
          `${QDRANT_URL}/collections/ekip_documents/points/scroll`,
          {
            filter: {
              must: [
                { key: 'org_id', match: { value: req.user.org_id } },
                { key: 'workspace_id', match: { value: req.user.workspace_id } },
                { key: 'department_id', match: { value: req.user.department_id } },
                { key: 'allowed_roles', match: { value: req.user.role } },
              ],
            },
            limit: 5000,
            offset,
            with_payload: ['document_id', 'filename', 'file_type'],
            with_vector: false,
          }
        );
        const result = response.data.result;

        for (const point of result.points) {
          const payload = point.payload || {};
          const id = payload.document_id;
          if (!id) continue;

          const document = indexedDocuments.get(id) || {
            id,
            filename: payload.filename || '',
            file_type: payload.file_type || '',
            status: 'Indexed',
            chunk_count: 0,
            created_at: null,
          };
          document.chunk_count += 1;
          indexedDocuments.set(id, document);
        }

        offset = result.next_page_offset;
      } while (offset !== null && offset !== undefined);

      const savedIds = new Set(savedDocuments.map((document) => document.id));
      const legacyDocuments = [...indexedDocuments.values()].filter(
        (document) => !savedIds.has(document.id)
      );
      res.json({ documents: [...savedDocuments, ...legacyDocuments] });
    } catch (err) {
      console.error('[ai] indexed document history unavailable:', err.message);
      res.json({
        documents: savedDocuments,
        warning: 'Previously indexed documents could not be loaded from the AI index',
      });
    }
  } catch (err) {
    console.error('[ai] /documents failed:', err.message);
    res.status(500).json({ error: 'Failed to load documents' });
  }
}

async function deleteDocument(req, res) {
  const { id } = req.params;
  let document;

  try {
    document = await prisma.document.findFirst({
      where: {
        id,
        department_id: req.user.department_id,
        allowed_roles: { has: req.user.role },
      },
    });

    if (document?.status === 'Processing') {
      return res.status(409).json({ error: 'Wait for processing to finish before deleting this document' });
    }

    const filter = {
      must: [
        { key: 'document_id', match: { value: id } },
        { key: 'org_id', match: { value: req.user.org_id } },
        { key: 'workspace_id', match: { value: req.user.workspace_id } },
        { key: 'department_id', match: { value: req.user.department_id } },
        { key: 'allowed_roles', match: { value: req.user.role } },
      ],
    };

    const existing = await axios.post(
      `${QDRANT_URL}/collections/ekip_documents/points/scroll`,
      { filter, limit: 1, with_payload: false, with_vector: false }
    );
    const hasIndexedChunks = existing.data.result.points.length > 0;

    if (!document && !hasIndexedChunks) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (hasIndexedChunks) {
      const deletion = await axios.post(
        `${QDRANT_URL}/collections/ekip_documents/points/delete?wait=true`,
        { filter }
      );
      if (deletion.data.status !== 'ok') {
        throw new Error('Qdrant did not confirm document deletion');
      }
    }

    if (document) {
      await prisma.document.delete({ where: { id: document.id } });
    }

    res.json({ message: 'Document deleted', id });
  } catch (err) {
    console.error('[ai] /documents/:id delete failed:', err.message);
    res.status(500).json({ error: 'Failed to delete document' });
  }
}

async function updateDocumentProgress(req, res) {
  const { id } = req.params;
  const { stage, progress, chunk_count: chunkCount } = req.body;

  if (
    typeof stage !== 'string' ||
    stage.length > 120 ||
    !Number.isInteger(progress) ||
    progress < 0 ||
    progress > 99 ||
    (chunkCount !== undefined && (!Number.isInteger(chunkCount) || chunkCount < 0))
  ) {
    return res.status(400).json({ error: 'Invalid document progress update' });
  }

  try {
    const result = await prisma.document.updateMany({
      where: {
        id,
        department_id: req.user.department_id,
        allowed_roles: { has: req.user.role },
        status: 'Processing',
      },
      data: { stage, progress, ...(chunkCount === undefined ? {} : { chunk_count: chunkCount }) },
    });

    if (!result.count) {
      return res.status(404).json({ error: 'Processing document not found' });
    }
    res.json({ updated: true });
  } catch (err) {
    console.error('[ai] document progress update failed:', err.message);
    res.status(500).json({ error: 'Failed to update document progress' });
  }
}

module.exports = {
  health,
  ask,
  updateAskProgress,
  getAskProgress,
  ingest,
  listDocuments,
  updateDocumentProgress,
  deleteDocument,
};
