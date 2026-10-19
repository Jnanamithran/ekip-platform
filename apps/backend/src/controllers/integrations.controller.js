const path = require('path');
const { google } = require('googleapis');
const { PrismaClient, Role } = require('@prisma/client');
const {
  encryptToken,
  decryptToken,
  signOAuthState,
  verifyOAuthState,
} = require('../utils/integrationSecurity');
const { ingestDocument } = require('./ai.controller');

const prisma = new PrismaClient();

const PROVIDER = 'google';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'; // read-only
const MAX_FILES_PER_IMPORT = 5;
const MAX_FILE_BYTES = 50 * 1024 * 1024; // same limit as normal uploads

// Only the file types EKIP can ingest
const MIME_TO_EXT = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
};

function newOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function frontendBase() {
  return (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
    .split(',')[0]
    .trim();
}

const tokenKey = (userId) => ({ user_id_provider: { user_id: userId, provider: PROVIDER } });

// Builds a Drive client for this user from their stored (encrypted) tokens.
// Returns null if they have not connected Google Drive.
async function getDrive(userId) {
  const record = await prisma.integrationToken.findUnique({ where: tokenKey(userId) });
  if (!record) return null;

  const client = newOAuthClient();
  client.setCredentials({
    access_token: decryptToken(record.access_token),
    refresh_token: record.refresh_token ? decryptToken(record.refresh_token) : undefined,
    expiry_date: record.expires_at ? record.expires_at.getTime() : undefined,
  });

  // Google refreshes the access token automatically; save the new one (encrypted)
  client.on('tokens', (t) => {
    if (!t.access_token) return;
    prisma.integrationToken
      .update({
        where: tokenKey(userId),
        data: {
          access_token: encryptToken(t.access_token),
          expires_at: t.expiry_date ? new Date(t.expiry_date) : null,
          ...(t.refresh_token && { refresh_token: encryptToken(t.refresh_token) }),
        },
      })
      .catch((e) => console.error('[integrations] could not save refreshed token:', e.message));
  });

  return google.drive({ version: 'v3', auth: client });
}

function isConnectionExpired(err) {
  return String(err?.message || '').includes('invalid_grant') || err?.code === 401;
}

async function replyReconnect(res, userId) {
  await prisma.integrationToken.deleteMany({ where: { user_id: userId, provider: PROVIDER } });
  return res.status(400).json({
    error: 'Google Drive connection expired. Please reconnect.',
    code: 'GOOGLE_RECONNECT_REQUIRED',
  });
}

// GET /integrations/google/connect  -> { url }. The frontend opens that URL.
function connect(req, res) {
  const url = newOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // makes Google return a refresh token every time
    scope: [DRIVE_SCOPE],
    state: signOAuthState(req.user.user_id), // signed, expires in 10 minutes
  });
  res.json({ url });
}

// GET /integrations/google/callback  (Google sends the browser here, with no login token)
async function callback(req, res) {
  const { code, state, error } = req.query;
  const back = (query) => res.redirect(`${frontendBase()}/integrations?${query}`);

  if (error) return back('error=access_denied');

  let userId;
  try {
    userId = verifyOAuthState(String(state || ''));
  } catch (err) {
    return res.status(400).send('Invalid or expired connection request. Please try connecting again.');
  }
  if (!code) return res.status(400).send('Missing authorization code.');

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { active: true } });
    if (!user || !user.active) return res.status(403).send('Account not allowed to connect.');

    const { tokens } = await newOAuthClient().getToken(String(code));
    const data = {
      access_token: encryptToken(tokens.access_token),
      expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      ...(tokens.refresh_token && { refresh_token: encryptToken(tokens.refresh_token) }),
    };
    await prisma.integrationToken.upsert({
      where: tokenKey(userId),
      update: data,
      create: { user_id: userId, provider: PROVIDER, ...data },
    });
    return back('connected=google');
  } catch (err) {
    console.error('[integrations] callback failed:', err.message);
    return back('error=connect_failed');
  }
}

// GET /integrations/google/status
async function status(req, res) {
  const record = await prisma.integrationToken.findUnique({
    where: tokenKey(req.user.user_id),
    select: { id: true },
  });
  res.json({ connected: Boolean(record) });
}

// GET /integrations/google/files  (optional ?page_token=...)
async function listFiles(req, res) {
  try {
    const drive = await getDrive(req.user.user_id);
    if (!drive) return res.status(400).json({ error: 'Google Drive not connected.' });

    const mimeQuery = Object.keys(MIME_TO_EXT).map((m) => `mimeType='${m}'`).join(' or ');
    const response = await drive.files.list({
      q: `(${mimeQuery}) and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
      orderBy: 'modifiedTime desc',
      pageSize: 50,
      pageToken: req.query.page_token ? String(req.query.page_token) : undefined,
    });
    res.json({ files: response.data.files, next_page_token: response.data.nextPageToken || null });
  } catch (err) {
    if (isConnectionExpired(err)) return replyReconnect(res, req.user.user_id);
    console.error('[integrations] list failed:', err.message);
    res.status(500).json({ error: 'Failed to list Google Drive files' });
  }
}

// POST /integrations/google/import
// Body: { files: [{ file_id, allowed_roles: ["Admin","Manager"] }] }
async function importFiles(req, res) {
  const { files } = req.body || {};

  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES_PER_IMPORT) {
    return res.status(400).json({ error: `Send between 1 and ${MAX_FILES_PER_IMPORT} files` });
  }

  // Validate everything BEFORE downloading anything
  for (const f of files) {
    const roles = f && f.allowed_roles;
    if (
      !f || typeof f.file_id !== 'string' || !f.file_id ||
      !Array.isArray(roles) || !roles.length ||
      !roles.every((r) => Object.values(Role).includes(r))
    ) {
      return res.status(400).json({
        error: 'Each file needs file_id and allowed_roles (a non-empty list of valid roles)',
      });
    }
    // The importer must be able to see what they import
    if (!roles.includes(req.user.role)) {
      return res.status(400).json({ error: 'allowed_roles must include your own role' });
    }
  }

  try {
    const drive = await getDrive(req.user.user_id);
    if (!drive) return res.status(400).json({ error: 'Google Drive not connected.' });

    const [, token] = (req.headers.authorization || '').split(' ');
    const results = [];

    // One at a time: each file can take minutes to process
    for (const f of files) {
      try {
        // Name and type come from Drive itself, never from the request body
        const meta = (
          await drive.files.get({ fileId: f.file_id, fields: 'id, name, mimeType, size' })
        ).data;

        const ext = MIME_TO_EXT[meta.mimeType];
        if (!ext) {
          results.push({ file_id: f.file_id, status: 'error', error: 'Unsupported file type' });
          continue;
        }
        if (Number(meta.size) > MAX_FILE_BYTES) {
          results.push({ file_id: f.file_id, status: 'error', error: 'File is larger than 50 MB' });
          continue;
        }

        const download = await drive.files.get(
          { fileId: f.file_id, alt: 'media' },
          { responseType: 'arraybuffer' }
        );

        const { status: code, body } = await ingestDocument({
          user: req.user,
          token,
          buffer: Buffer.from(download.data),
          filename: path.parse(meta.name).name + ext,
          mimetype: meta.mimeType,
          allowedRoles: [...new Set(f.allowed_roles)],
        });

        results.push(
          code === 200
            ? { file_id: f.file_id, filename: meta.name, status: 'success', ...body }
            : { file_id: f.file_id, filename: meta.name, status: 'error', error: body.error }
        );
      } catch (err) {
        if (isConnectionExpired(err)) return replyReconnect(res, req.user.user_id);
        console.error('[integrations] import failed for one file:', err.message);
        results.push({ file_id: f.file_id, status: 'error', error: 'Could not import this file' });
      }
    }

    res.json({ results });
  } catch (err) {
    console.error('[integrations] import failed:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// DELETE /integrations/google/disconnect
async function disconnect(req, res) {
  try {
    await prisma.integrationToken.deleteMany({
      where: { user_id: req.user.user_id, provider: PROVIDER },
    });
    res.json({ message: 'Google Drive disconnected.' });
  } catch (err) {
    console.error('[integrations] disconnect failed:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

module.exports = { connect, callback, status, listFiles, importFiles, disconnect };