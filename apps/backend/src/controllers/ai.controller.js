const axios = require('axios');
const FORM_DATA = require('form-data');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

// AI service base URL (set via env in Docker; default to localhost for dev)
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const DOCUMENT_MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
};
const UPLOAD_STORAGE_DIR = path.resolve(
  process.env.UPLOAD_STORAGE_DIR || path.join(__dirname, '../../uploads')
);
const prisma = new PrismaClient();

function storedDocumentPath(storageKey) {
  if (
    typeof storageKey !== 'string' ||
    path.basename(storageKey) !== storageKey ||
    !/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(storageKey)
  ) {
    throw new Error('Invalid document storage key');
  }
  return path.join(UPLOAD_STORAGE_DIR, storageKey);
}

// Build the RBAC payload extracted from the verified JWT token.
// The AI service trusts this because it comes from the backend.
function rbacFromReq(req) {
  return {
    org_id       : req.user.org_id,
    workspace_id : req.user.workspace_id,
    department_id: req.user.department_id,
    role_id      : req.user.role_id,
    is_owner     : req.user.is_owner,
  };
}

function documentAccessWhere(req, { manageAccess = false } = {}) {
  const canManageAccess =
    manageAccess &&
    (req.user.is_owner || req.user.permissions.includes('documents:manage_access'));
  return {
    department: {
      workspace: { org_id: req.user.org_id },
    },
    ...(!req.user.is_owner && !canManageAccess && {
      allowed_roles: { some: { role_id: req.user.role_id } },
    }),
  };
}

function qdrantAccessFilter(req, { manageAccess = false } = {}) {
  const must = [{ key: 'org_id', match: { value: req.user.org_id } }];
  const canManageAccess =
    manageAccess &&
    (req.user.is_owner || req.user.permissions.includes('documents:manage_access'));
  if (!req.user.is_owner && !canManageAccess) {
    must.push({ key: 'allowed_role_ids', match: { value: req.user.role_id } });
  }
  return { must };
}

async function validateAllowedRoleIds(allowedRoleIds, user) {
  if (
    !Array.isArray(allowedRoleIds) ||
    !allowedRoleIds.length ||
    allowedRoleIds.some((id) => typeof id !== 'string') ||
    new Set(allowedRoleIds).size !== allowedRoleIds.length
  ) {
    return { error: 'allowed_role_ids must be a non-empty list of role IDs' };
  }

  const roles = await prisma.organizationRole.findMany({
    where: { id: { in: allowedRoleIds }, org_id: user.org_id },
    select: { id: true },
  });
  if (roles.length !== allowedRoleIds.length) {
    return { error: 'Every document access role must belong to your organization' };
  }
  if (!user.is_owner && !allowedRoleIds.includes(user.role_id)) {
    return { error: 'Document access must include your own role' };
  }
  if (
    !user.is_owner &&
    !user.permissions.includes('documents:manage_access') &&
    (allowedRoleIds.length !== 1 || allowedRoleIds[0] !== user.role_id)
  ) {
    return { error: 'You do not have permission to assign document access roles' };
  }
  return { roleIds: allowedRoleIds };
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
  let failureMessage = 'Failed to start search';
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

    failureMessage = 'Failed to reach AI service';
    const resp = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
    });

    // Transform the AI service's citation shape to match the frontend contract
    const sources = resp.data.sources.map((s) => ({
      id: s.id,
      document_id: s.document_id,
      filename: s.filename,
      page: s.page,
      excerpt: s.excerpt,
      type: s.type || 'text',
    }));
    const sourceDocumentCount = new Set(sources.map((source) => source.filename)).size;
    const answerSummary = sources.length
      ? `This answer is based on ${sources.length} cited passage${sources.length === 1 ? '' : 's'} from ${sourceDocumentCount} document${sourceDocumentCount === 1 ? '' : 's'}.`
      : 'No supporting passages were found in the documents available to you.';
    failureMessage = 'Answer was generated but could not be saved to history';
    const historyEntry = await prisma.aiAnswerHistory.create({
      data: {
        request_id: requestId,
        user_id: req.user.user_id,
        question: req.body.query,
        answer: resp.data.answer,
        sources,
        model: resp.data.model,
        has_answer: resp.data.has_answer,
      },
      select: { id: true, created_at: true },
    });

    res.json({
      history_id: historyEntry.id,
      created_at: historyEntry.created_at,
      answer: resp.data.answer,
      sources,
      model: resp.data.model,
      has_answer: resp.data.has_answer,
      answer_summary: answerSummary,
    });
  } catch (err) {
    console.error('[ai] /ask failed:', err.message);
    if (err.response) {
      res.status(err.response.status).json({ error: err.response.data });
    } else {
      res.status(500).json({ error: failureMessage });
    }
  }
}

async function listAnswerHistory(req, res) {
  try {
    const entries = await prisma.aiAnswerHistory.findMany({
      where: { user_id: req.user.user_id },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    res.json({
      entries: entries.reverse().map((entry) => {
        const sources = Array.isArray(entry.sources) ? entry.sources : [];
        const documentCount = new Set(sources.map((source) => source.filename)).size;
        return {
          id: entry.id,
          query: entry.question,
          created_at: entry.created_at,
          result: {
            answer: entry.answer,
            sources,
            model: entry.model,
            has_answer: entry.has_answer,
            answer_summary: sources.length
              ? `This answer is based on ${sources.length} cited passage${sources.length === 1 ? '' : 's'} from ${documentCount} document${documentCount === 1 ? '' : 's'}.`
              : 'No supporting passages were found in the documents available to you.',
          },
        };
      }),
    });
  } catch (err) {
    console.error('[ai] answer history lookup failed:', err.message);
    res.status(500).json({ error: 'Failed to load question history' });
  }
}

// Remove every saved question/answer pair for the authenticated user.
async function clearAnswerHistory(req, res) {
  try {
    const result = await prisma.aiAnswerHistory.deleteMany({
      where: { user_id: req.user.user_id },
    });
    res.json({ deleted: result.count });
  } catch (err) {
    console.error('[ai] answer history clear failed:', err.message);
    res.status(500).json({ error: 'Failed to clear question history' });
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

// Shared by normal uploads and Google Drive imports.
// Returns { status, body } so each caller decides how to reply.
async function ingestDocument({
  user,
  token,
  buffer,
  filename: rawFilename,
  mimetype,
  allowedRoleIds,
  departmentId,
}) {
  const access = await validateAllowedRoleIds(allowedRoleIds, user);
  if (access.error) return { status: 400, body: { error: access.error } };

  let targetDepartmentId = user.department_id;
  if (departmentId) {
    const dept = await prisma.department.findFirst({
      where: {
        id: departmentId,
        workspace: { org_id: user.org_id },
      },
      select: { id: true },
    });
    if (!dept) {
      return { status: 400, body: { error: 'Invalid department specified' } };
    }
    targetDepartmentId = dept.id;
  }

  const documentId = randomUUID();
  let documentCreated = false;

  try {
    const filename = path.basename(String(rawFilename).replace(/\\/g, '/'));
    const extension = path.extname(filename).toLowerCase();
    const fileType = extension.slice(1);
    if (!['.pdf', '.docx', '.xlsx', '.txt'].includes(extension)) {
      return { status: 400, body: { error: 'Supported file types are PDF, DOCX, XLSX, and TXT' } };
    }
    const storageKey = `${documentId}${extension}`;
    await prisma.document.create({
      data: {
        id: documentId,
        department_id: targetDepartmentId,
        filename,
        file_type: fileType,
        status: 'Processing',
        stage: 'File received',
        progress: 5,
        uploaded_by: user.user_id,
        allowed_roles: { create: access.roleIds.map((role_id) => ({ role_id })) },
      },
    });
    documentCreated = true;

    await fs.mkdir(UPLOAD_STORAGE_DIR, { recursive: true });
    await fs.writeFile(storedDocumentPath(storageKey), buffer, { flag: 'wx' });
    await prisma.document.update({
      where: { id: documentId },
      data: { storage_key: storageKey },
    });

    // Build FormData for multipart upload
    const form = new FORM_DATA();
    form.append('rbac', JSON.stringify({
      ...rbacFromReq({ user }),
      department_id: targetDepartmentId,
      user_id: user.user_id,
      allowed_role_ids: access.roleIds,
    }));
    form.append('token', token || '');
    form.append('document_id', documentId);
    form.append('file', buffer, { filename, contentType: mimetype });

    const resp = await axios.post(`${AI_SERVICE_URL}/ingest`, form, {
      headers: { ...form.getHeaders() },
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

    return {
      status: 200,
      body: { ...resp.data, document_id: document.id, preview_available: fileType === 'pdf' },
    };
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
      return {
        status: err.response.status,
        body: { error: err.response.data?.detail || 'AI service rejected the document' },
      };
    }
    if (err.code === 'ECONNABORTED') {
      return {
        status: 504,
        body: { error: 'Document processing timed out; check its status before retrying' },
      };
    }
    return { status: 500, body: { error: 'Failed to reach AI service' } };
  }
}

// POST /ai/ingest: a normal upload. Visible only to the uploader's own role, as before.
async function ingest(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'A document file is required' });
  }
  let allowedRoleIds = [req.user.role_id];
  if (req.body.allowed_role_ids !== undefined) {
    try {
      allowedRoleIds = typeof req.body.allowed_role_ids === 'string'
        ? JSON.parse(req.body.allowed_role_ids)
        : req.body.allowed_role_ids;
    } catch {
      return res.status(400).json({ error: 'allowed_role_ids must be valid JSON' });
    }
  }
  const departmentId = typeof req.body.department_id === 'string' && req.body.department_id.trim()
    ? req.body.department_id.trim()
    : undefined;

  const { status, body } = await ingestDocument({
    user: req.user,
    token: req.headers['x-ai-token'] || '',
    buffer: req.file.buffer,
    filename: req.file.originalname,
    mimetype: req.file.mimetype,
    allowedRoleIds,
    departmentId,
  });
  res.status(status).json(body);
}

async function deleteDocumentVectors(collection, documentId, orgId) {
  try {
    await axios.get(`${QDRANT_URL}/collections/${collection}`);
  } catch (err) {
    if (err.response?.status === 404) return;
    throw err;
  }

  const deletion = await axios.post(
    `${QDRANT_URL}/collections/${collection}/points/delete?wait=true`,
    {
      filter: {
        must: [
          { key: 'document_id', match: { value: documentId } },
          { key: 'org_id', match: { value: orgId } },
        ],
      },
    }
  );
  if (deletion.data.status !== 'ok') {
    throw new Error(`Qdrant did not confirm deletion from ${collection}`);
  }
}

async function setDocumentVectorAccess(collection, documentId, orgId, roleIds) {
  try {
    await axios.get(`${QDRANT_URL}/collections/${collection}`);
  } catch (err) {
    if (err.response?.status === 404) return;
    throw err;
  }
  const response = await axios.post(
    `${QDRANT_URL}/collections/${collection}/points/payload?wait=true`,
    {
      payload: { allowed_role_ids: roleIds },
      filter: {
        must: [
          { key: 'document_id', match: { value: documentId } },
          { key: 'org_id', match: { value: orgId } },
        ],
      },
    }
  );
  if (response.data.status !== 'ok') {
    throw new Error(`Qdrant did not confirm access update in ${collection}`);
  }
}

async function updateDocumentAccess(req, res) {
  const { id } = req.params;
  const { allowed_role_ids: allowedRoleIds } = req.body || {};
  const access = await validateAllowedRoleIds(allowedRoleIds, req.user);
  if (access.error) return res.status(400).json({ error: access.error });

  try {
    const document = await prisma.document.findFirst({
      where: { id, department: { workspace: { org_id: req.user.org_id } } },
      select: { id: true, department_id: true, status: true },
    });
    if (!document) return res.status(404).json({ error: 'Document not found' });
    if (document.status === 'Processing') {
      return res.status(409).json({ error: 'Wait for processing to finish before changing access' });
    }

    for (const collection of ['ekip_documents', 'ekip_visual_documents']) {
      await setDocumentVectorAccess(collection, id, req.user.org_id, []);
    }

    await prisma.$transaction([
      prisma.documentRoleAccess.deleteMany({ where: { document_id: id } }),
      prisma.documentRoleAccess.createMany({
        data: access.roleIds.map((role_id) => ({ document_id: id, role_id })),
      }),
    ]);

    for (const collection of ['ekip_documents', 'ekip_visual_documents']) {
      await setDocumentVectorAccess(collection, id, req.user.org_id, access.roleIds);
    }
    return res.json({ updated: true, allowed_role_ids: access.roleIds });
  } catch (err) {
    console.error('[ai] document access update failed:', err.message);
    return res.status(500).json({ error: 'Failed to update document access; re-index the document if search access is incomplete' });
  }
}

async function reindexDocument(req, res) {
  const { id } = req.params;

  try {
    const document = await prisma.document.findFirst({
      where: { id, ...documentAccessWhere(req) },
      include: {
        allowed_roles: { select: { role_id: true } },
        department: {
          select: {
            id: true,
            workspace_id: true,
            workspace: { select: { org_id: true } },
          },
        },
      },
    });
    if (!document) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    if (document.status === 'Processing') {
      return res.status(409).json({ error: 'Document is already being processed.' });
    }
    if (!document.storage_key) {
      return res.status(409).json({
        error: 'The original file is unavailable. Re-upload this document to re-index it.',
      });
    }

    const mimetype = DOCUMENT_MIME_TYPES[document.file_type];
    if (!mimetype) {
      return res.status(415).json({ error: 'This document type cannot be re-indexed.' });
    }
    if (!document.allowed_roles.length) {
      return res.status(409).json({
        error: 'The document has no valid access roles and cannot be re-indexed.',
      });
    }

    let buffer;
    try {
      buffer = await fs.readFile(storedDocumentPath(document.storage_key));
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(409).json({
          error: 'The original file is unavailable. Re-upload this document to re-index it.',
        });
      }
      throw err;
    }

    const claimed = await prisma.document.updateMany({
      where: {
        id,
        ...documentAccessWhere(req),
        status: { not: 'Processing' },
      },
      data: {
        status: 'Processing',
        stage: 'Preparing document for re-indexing',
        progress: 0,
        chunk_count: 0,
      },
    });
    if (!claimed.count) {
      return res.status(409).json({ error: 'Document is already being processed.' });
    }

    try {
      await deleteDocumentVectors('ekip_documents', id, req.user.org_id);
      await deleteDocumentVectors('ekip_visual_documents', id, req.user.org_id);

      const form = new FORM_DATA();
      form.append('rbac', JSON.stringify({
        org_id: document.department.workspace.org_id,
        workspace_id: document.department.workspace_id,
        department_id: document.department_id,
        role_id: req.user.role_id,
        is_owner: req.user.is_owner,
        user_id: document.uploaded_by,
        allowed_role_ids: document.allowed_roles.map((role) => role.role_id),
      }));
      form.append('token', req.headers['x-ai-token'] || '');
      form.append('document_id', id);
      form.append('file', buffer, {
        filename: document.filename,
        contentType: mimetype,
      });

      const response = await axios.post(`${AI_SERVICE_URL}/ingest`, form, {
        headers: { ...form.getHeaders() },
        timeout: 10 * 60 * 1000,
      });

      await prisma.document.update({
        where: { id },
        data: {
          status: response.data.status || 'Indexed',
          stage: 'Complete',
          progress: 100,
          chunk_count: response.data.chunk_count || 0,
        },
      });
      return res.json({ message: 'Re-indexing complete.', id });
    } catch (err) {
      console.error('[ai] document re-index failed:', err.message);
      await prisma.document.update({
        where: { id },
        data: {
          status: err.code === 'ECONNABORTED' ? 'Timed out' : 'Failed',
          stage: err.code === 'ECONNABORTED' ? 'Processing timed out' : 'Processing failed',
        },
      });
      if (err.response && err.config?.url === `${AI_SERVICE_URL}/ingest`) {
        return res.status(err.response.status).json({
          error: err.response.data?.detail || 'AI service rejected the document',
        });
      }
      if (err.code === 'ECONNABORTED') {
        return res.status(504).json({
          error: 'Document processing timed out; check its status before retrying',
        });
      }
      return res.status(500).json({ error: 'Failed to re-index document' });
    }
  } catch (err) {
    console.error('[ai] /documents/:id/reindex failed:', err.message);
    return res.status(500).json({ error: 'Failed to re-index document' });
  }
}

async function listDocuments(req, res) {
  try {
    const savedDocuments = await prisma.document.findMany({
      where: documentAccessWhere(req, { manageAccess: true }),
      select: {
        id: true,
        department_id: true,
        department: { select: { id: true, name: true } },
        filename: true,
        file_type: true,
        status: true,
        stage: true,
        progress: true,
        chunk_count: true,
        storage_key: true,
        created_at: true,
        allowed_roles: { select: { role_id: true } },
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
            filter: qdrantAccessFilter(req, { manageAccess: true }),
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
      res.json({
        documents: [
          ...savedDocuments.map(({ storage_key: storageKey, allowed_roles: allowedRoles, department, ...document }) => ({
            ...document,
            department_id: document.department_id,
            department_name: department?.name || '',
            allowed_role_ids: allowedRoles.map((role) => role.role_id),
            preview_available: Boolean(storageKey && document.file_type === 'pdf'),
          })),
          ...legacyDocuments.map((document) => ({ ...document, preview_available: false })),
        ],
      });
    } catch (err) {
      console.error('[ai] indexed document history unavailable:', err.message);
      res.json({
        documents: savedDocuments.map(({ storage_key: storageKey, allowed_roles: allowedRoles, department, ...document }) => ({
          ...document,
          department_id: document.department_id,
          department_name: department?.name || '',
          allowed_role_ids: allowedRoles.map((role) => role.role_id),
          preview_available: Boolean(storageKey && document.file_type === 'pdf'),
        })),
        warning: 'Previously indexed documents could not be loaded from the AI index',
      });
    }
  } catch (err) {
    console.error('[ai] /documents failed:', err.message);
    res.status(500).json({ error: 'Failed to load documents' });
  }
}

async function previewDocument(req, res) {
  try {
    const document = await prisma.document.findFirst({
      where: {
        id: req.params.id,
        ...documentAccessWhere(req),
        file_type: 'pdf',
        storage_key: { not: null },
      },
      select: { filename: true, storage_key: true },
    });
    if (!document) {
      return res.status(404).json({
        error: 'PDF preview is unavailable. Re-upload this document to enable preview.',
      });
    }

    const filePath = storedDocumentPath(document.storage_key);
    await fs.access(filePath);
    const safeFilename = document.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeFilename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('[ai] PDF preview transfer failed:', err.message);
        if (!res.headersSent) {
          res.status(err.statusCode === 404 ? 404 : 500).json({
            error: 'Failed to load PDF preview',
          });
        }
      }
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({
        error: 'PDF preview is unavailable. Re-upload this document to enable preview.',
      });
    }
    console.error('[ai] PDF preview failed:', err.message);
    res.status(500).json({ error: 'Failed to load PDF preview' });
  }
}

// --- Serve a rendered page image (visual citations for scanned PDFs) ---

// Standard UUID — also guarantees the image filename built below can never
// traverse outside the visual storage directory.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getDocumentPageImage(req, res) {
  const { id, page_num: pageParam } = req.params;
  const pageNum = Number(pageParam);
  if (!UUID_RE.test(id) || !Number.isInteger(pageNum) || pageNum < 1) {
    return res.status(400).json({ error: 'Invalid document id or page number' });
  }

  try {
    const document = await prisma.document.findFirst({
      where: {
        id,
        ...documentAccessWhere(req),
      },
      select: { id: true },
    });
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Page images are rendered by the visual AI service during ingestion of
    // scanned PDFs and persisted to the shared document_uploads volume at
    // uploads/visual/{document_id}_page{N}.jpg (mounted at UPLOAD_STORAGE_DIR).
    const imagePath = path.join(
      UPLOAD_STORAGE_DIR,
      'visual',
      `${id}_page${pageNum}.jpg`
    );
    await fs.access(imagePath);

    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    res.sendFile(imagePath, (err) => {
      if (err && !res.headersSent) {
        res.status(err.statusCode === 404 ? 404 : 500).json({
          error: 'Failed to load page image',
        });
      }
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({
        error:
          'No rendered page image for this document/page. Page images only exist for scanned PDFs processed by the visual pipeline.',
      });
    }
    console.error('[ai] page image failed:', err.message);
    res.status(500).json({ error: 'Failed to load page image' });
  }
}

async function deleteDocument(req, res) {
  const { id } = req.params;
  let document;

  try {
    document = await prisma.document.findFirst({
      where: {
        id,
        ...documentAccessWhere(req),
      },
    });

    if (document?.status === 'Processing') {
      return res.status(409).json({ error: 'Wait for processing to finish before deleting this document' });
    }

    const filter = {
      must: [
        { key: 'document_id', match: { value: id } },
        ...qdrantAccessFilter(req).must,
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
      if (document.storage_key) {
        try {
          await fs.unlink(storedDocumentPath(document.storage_key));
        } catch (fileError) {
          if (fileError.code !== 'ENOENT') throw fileError;
        }
      }
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
        ...documentAccessWhere(req),
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
  listAnswerHistory,
  clearAnswerHistory,
  ingest,  ingestDocument,
  validateAllowedRoleIds,
  reindexDocument,
  listDocuments,
  previewDocument,
  getDocumentPageImage,
  updateDocumentProgress,
  deleteDocument,
  updateDocumentAccess,
};
