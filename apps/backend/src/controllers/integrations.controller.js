const path = require('path');
const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');
const {
  encryptToken,
  decryptToken,
  signOAuthState,
  verifyOAuthState,
} = require('../utils/integrationSecurity');
const { ingestDocument, validateAllowedRoleIds } = require('./ai.controller');

const prisma = new PrismaClient();

const PROVIDER = 'google';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'; // read-only
const MAX_FILES_PER_IMPORT = 5;
const MAX_FILE_BYTES = 50 * 1024 * 1024; // same limit as normal uploads
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

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
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        active: true,
        role: { select: { permissions: true } },
        department: {
          select: {
            workspace: {
              select: {
                organization: { select: { owner_user_id: true } },
              },
            },
          },
        },
      },
    });
    const isOwner = user?.department.workspace.organization.owner_user_id === userId;
    if (
      !user ||
      !user.active ||
      (!isOwner && !user.role.permissions.includes('drive:connect'))
    ) {
      return res.status(403).send('Account not allowed to connect.');
    }

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

function driveParentQuery(parentId) {
  const id = typeof parentId === 'string' && parentId ? parentId : 'root';
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('Invalid Google Drive folder ID');
  }
  return `'${id}' in parents and trashed=false`;
}

async function listFolders(req, res) {
  try {
    const drive = await getDrive(req.user.user_id);
    if (!drive) return res.status(400).json({ error: 'Google Drive not connected.' });

    const response = await drive.files.list({
      q: `${driveParentQuery(req.query.parent_id)} and mimeType='${FOLDER_MIME_TYPE}'`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
      orderBy: 'name',
      pageSize: 50,
      pageToken: req.query.page_token ? String(req.query.page_token) : undefined,
    });
    res.json({ folders: response.data.files, next_page_token: response.data.nextPageToken || null });
  } catch (err) {
    if (isConnectionExpired(err)) return replyReconnect(res, req.user.user_id);
    if (err.message === 'Invalid Google Drive folder ID') {
      return res.status(400).json({ error: err.message });
    }
    console.error('[integrations] folder listing failed:', err.message);
    res.status(500).json({ error: 'Failed to list Google Drive folders' });
  }
}

// GET /integrations/google/files (optional ?parent_id=...&page_token=...)
async function listFiles(req, res) {
  try {
    const drive = await getDrive(req.user.user_id);
    if (!drive) return res.status(400).json({ error: 'Google Drive not connected.' });

    const mimeQuery = Object.keys(MIME_TO_EXT)
      .map((mimeType) => `mimeType='${mimeType}'`)
      .join(' or ');
    const response = await drive.files.list({
      q: `${driveParentQuery(req.query.parent_id)} and (${mimeQuery})`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
      orderBy: 'name',
      pageSize: 50,
      pageToken: req.query.page_token ? String(req.query.page_token) : undefined,
    });
    res.json({ files: response.data.files, next_page_token: response.data.nextPageToken || null });
  } catch (err) {
    if (isConnectionExpired(err)) return replyReconnect(res, req.user.user_id);
    if (err.message === 'Invalid Google Drive folder ID') {
      return res.status(400).json({ error: err.message });
    }
    console.error('[integrations] list failed:', err.message);
    res.status(500).json({ error: 'Failed to list Google Drive files' });
  }
}

async function listFolderFiles(drive, folderId, foundFiles, visitedFolders) {
  if (visitedFolders.has(folderId)) return;
  visitedFolders.add(folderId);
  let pageToken;
  do {
    const response = await drive.files.list({
      q: driveParentQuery(folderId),
      fields: 'nextPageToken, files(id, name, mimeType, size)',
      pageSize: 100,
      pageToken,
    });
    for (const item of response.data.files || []) {
      if (item.mimeType === FOLDER_MIME_TYPE) {
        await listFolderFiles(drive, item.id, foundFiles, visitedFolders);
      } else if (MIME_TO_EXT[item.mimeType]) {
        foundFiles.push(item);
      }
      if (foundFiles.length > MAX_FILES_PER_IMPORT) return;
    }
    pageToken = response.data.nextPageToken;
  } while (pageToken && foundFiles.length <= MAX_FILES_PER_IMPORT);
}

// POST /integrations/google/import
// Body: { files: [{ file_id, is_folder, allowed_role_ids: [...] }] }
async function importFiles(req, res) {
  const { files } = req.body || {};

  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES_PER_IMPORT) {
    return res.status(400).json({ error: `Send between 1 and ${MAX_FILES_PER_IMPORT} files` });
  }

  const validatedFiles = [];
  for (const f of files) {
    if (
      !f || typeof f.file_id !== 'string' || !f.file_id ||
      !/^[A-Za-z0-9_-]+$/.test(f.file_id) ||
      (f.is_folder !== undefined && typeof f.is_folder !== 'boolean')
    ) {
      return res.status(400).json({
        error: 'Each selection needs a valid file_id and optional is_folder flag',
      });
    }
    const access = await validateAllowedRoleIds(
      f.allowed_role_ids || [req.user.role_id],
      req.user
    );
    if (access.error) return res.status(400).json({ error: access.error });
    validatedFiles.push({ ...f, allowed_role_ids: access.roleIds });
  }

  try {
    const drive = await getDrive(req.user.user_id);
    if (!drive) return res.status(400).json({ error: 'Google Drive not connected.' });

    const [, token] = (req.headers.authorization || '').split(' ');

    const selectionsToImport = [];
    for (const selection of validatedFiles) {
      const metadata = (
        await drive.files.get({
          fileId: selection.file_id,
          fields: 'id, name, mimeType, size',
        })
      ).data;
      if (selection.is_folder) {
        if (metadata.mimeType !== FOLDER_MIME_TYPE) {
          return res.status(400).json({ error: `${metadata.name} is not a Google Drive folder` });
        }
        const folderFiles = [];
        await listFolderFiles(drive, metadata.id, folderFiles, new Set());
        if (folderFiles.length > MAX_FILES_PER_IMPORT) {
          return res.status(400).json({
            error: `Folder "${metadata.name}" contains more than ${MAX_FILES_PER_IMPORT} supported files; select a smaller folder`,
          });
        }
        selectionsToImport.push(
          ...folderFiles.map((file) => ({
            file,
            allowed_role_ids: selection.allowed_role_ids,
          }))
        );
      } else {
        if (!MIME_TO_EXT[metadata.mimeType]) {
          return res.status(400).json({ error: `Unsupported file type: ${metadata.name}` });
        }
        selectionsToImport.push({ file: metadata, allowed_role_ids: selection.allowed_role_ids });
      }
      if (selectionsToImport.length > MAX_FILES_PER_IMPORT) {
        return res.status(400).json({
          error: `Select no more than ${MAX_FILES_PER_IMPORT} supported files per import`,
        });
      }
    }

    // Validate all selections before downloading any content.
    const results = [];
    for (const selection of selectionsToImport) {
      try {
        const meta = selection.file;
        const ext = MIME_TO_EXT[meta.mimeType];
        if (Number(meta.size) > MAX_FILE_BYTES) {
          results.push({ file_id: meta.id, status: 'error', error: 'File is larger than 50 MB' });
          continue;
        }

        const download = await drive.files.get(
          { fileId: meta.id, alt: 'media' },
          { responseType: 'arraybuffer' }
        );

        const { status: code, body } = await ingestDocument({
          user: req.user,
          token,
          buffer: Buffer.from(download.data),
          filename: path.parse(meta.name).name + ext,
          mimetype: meta.mimeType,
          allowedRoleIds: selection.allowed_role_ids,
        });

        results.push(
          code === 200
            ? { file_id: meta.id, filename: meta.name, ...body, status: 'success' }
            : { file_id: meta.id, filename: meta.name, status: 'error', error: body.error }
        );
      } catch (err) {
        if (isConnectionExpired(err)) return replyReconnect(res, req.user.user_id);
        console.error('[integrations] import failed for one file:', err.message);
        results.push({ file_id: selection.file.id, status: 'error', error: 'Could not import this file' });
      }
    }

    res.json({
      results,
      imported_count: results.filter((result) => result.status === 'success').length,
      skipped_count: results.filter((result) => result.status === 'error').length,
    });
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

module.exports = { connect, callback, status, listFolders, listFiles, importFiles, disconnect };