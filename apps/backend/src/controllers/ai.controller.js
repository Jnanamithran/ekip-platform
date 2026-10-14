const axios = require('axios');
const FORM_DATA = require('form-data');

// AI service base URL (set via env in Docker; default to localhost for dev)
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

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

    const payload = {
      query: req.body.query,
      rbac,
      token: req.headers['x-ai-token'] || '',
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

    res.json({
      answer: resp.data.answer,
      sources,
      model: resp.data.model,
      has_answer: resp.data.has_answer,
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

// --- Ingest a document ---

async function ingest(req, res) {
  try {
    // Build FormData for multipart upload
    const form = new FORM_DATA();
    form.append('query', req.body.query || '');
    form.append('rbac', JSON.stringify(rbacFromReq(req)));
    form.append('token', req.headers['x-ai-token'] || '');
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const resp = await axios.post(`${AI_SERVICE_URL}/ingest`, form, {
      headers: {
        ...form.getHeaders(),
      },
    });

    res.json(resp.data);
  } catch (err) {
    console.error('[ai] /ingest failed:', err.message);
    if (err.response) {
      res.status(err.response.status).json({ error: err.response.data });
    } else {
      res.status(500).json({ error: 'Failed to reach AI service' });
    }
  }
}

module.exports = { health, ask, ingest };
