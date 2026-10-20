# Backend Handbook

Owner: Backend Developer. Covers the Express API, authentication, RBAC middleware and request/response formats.

Stack: Node.js, Express.js, JWT, PostgreSQL, Prisma ORM (`apps/backend`).

## Authentication and RBAC

### Overview
The backend authenticates users with JWTs. The token is the source of truth for a user's organization, workspace, department and role. The AI service relies on these values, so they are only ever read from the verified token, never from a request body.

- **Access token:** JWT signed with HS256, expires after 15 minutes.
- **Refresh token:** random string valid for 7 days, single use. Only its SHA-256 hash is stored in the `RefreshToken` table.
- Protected requests send `Authorization: Bearer <access_token>`.

### Token payload
| Field | Meaning |
|---|---|
| `user_id` | The user's id |
| `org_id` | The user's organization (looked up through department → workspace) |
| `workspace_id` | The user's workspace |
| `department_id` | The user's department |
| `role` | `Admin`, `Manager`, `Employee` or `Intern` |

These are the field names agreed with the AI service.

### Endpoints

**POST /auth/login**
- Body: `{ "email": "...", "password": "..." }`
- 200: `{ "access_token": "...", "refresh_token": "..." }`
- 400: email or password missing
- 401: invalid email or password (same message for both cases)
- 403: account deactivated (`code: "ACCOUNT_DEACTIVATED"`), returned only after the correct password

**POST /auth/refresh**
- Body: `{ "refresh_token": "..." }`
- 200: a new `access_token` and a new `refresh_token`. The old refresh token is deleted, so it cannot be used again.
- 400: `refresh_token` missing
- 401: invalid or expired refresh token
- 403: account deactivated (`code: "ACCOUNT_DEACTIVATED"`)

**POST /auth/logout**
- Body: `{ "refresh_token": "..." }`
- 200: `{ "message": "Logged out" }`. The refresh token can no longer be used.
- 400: `refresh_token` missing

**GET /auth/me** (requires access token)
- 200: `{ "user": { user_id, org_id, workspace_id, department_id, role } }`
- 401: missing, malformed, tampered or expired token

**POST /admin/users** (Admin only)
- Body: `{ "email", "password", "role", "department_id" }`
- Rules: valid email, password of at least 8 characters, `role` must be one of the four roles, and `department_id` must belong to the admin's own organization.
- 201: `{ "user": { id, email, role, department_id } }` (the password hash is never returned)
- 400: invalid or missing fields
- 401: no or invalid token
- 403: caller is not an Admin
- 404: department not found (also returned when it belongs to another organization)
- 409: a user with that email already exists

### User lifecycle (Admin only)
All four routes only act on users inside the admin's own organization. A user in another organization returns 404, the same as one that does not exist.

**PATCH /admin/users/:id**
- Body (all optional, at least one required): `{ "email", "role", "department_id" }`
- `department_id` must belong to the admin's own organization. An admin cannot change their own role.
- 200: `{ "user": { id, email, role, department_id, active } }`
- 400: invalid field, nothing to update, or changing own role
- 404: user or department not found
- 409: email already in use

**POST /admin/users/:id/reset-password**
- 200: `{ "temp_password", "message" }`. The password is random (`crypto.randomBytes`). All of the user's refresh tokens are deleted, so they are logged out everywhere.
- 404: user not found

**PATCH /admin/users/:id/deactivate**
- 200: `{ "message": "User deactivated." }`
- 400: an admin cannot deactivate their own account
- 404: user not found

**PATCH /admin/users/:id/reactivate**
- 200: `{ "message": "User reactivated." }`
- 404: user not found

**Design decisions**
- Deactivation is a soft flag (`User.active`), not a delete, so documents they uploaded stay linked to them.
- Deactivating deletes the user's refresh tokens, and `login` and `refresh` reject inactive users.
- A deactivated user's current access token stays valid until it expires (up to 15 minutes). Closing that gap would need a database check in `authenticate` on every request.
- Deactivate and reset run the database update and the token deletion in one transaction, so both happen or neither does.

### Middleware
- `authenticate`: verifies the access token and attaches `req.user` (the five fields above). Returns 401 if the token is missing or invalid.
- `requireRole(...roles)`: used after `authenticate`. Returns 403 if `req.user.role` is not in the list.
- All routes under `/admin` use both, applied once in `admin.routes.js`.

### AI service context
Query time sends `org_id`, `workspace_id`, `department_id` and `role`. Document upload sends `org_id`, `workspace_id`, `department_id`, `allowed_roles` and `uploaded_by`. All values come from `req.user`. (Upload and query routes are not built yet.)

## Analytics (Admin only)

**GET /admin/analytics/queries**
- 200: `{ "data": [{ "date": "2026-10-20", "count": 12 }, ...] }`. The last 7 days (UTC), oldest first. Every day is present, with `count: 0` when nobody asked a question.
- Counts the questions answered for users in the admin's own organization. The organization comes from the token, not from the request.
- 401: no or invalid token
- 403: caller is not an Admin

**Design decisions**
- Admin-only, whole organization, UTC days. Managers and per-workspace views are not included yet.
- `AiAnswerHistory` stores only `user_id`, so the endpoint first finds the organization's users, then counts their rows.

**Known limitation:** counts come from `AiAnswerHistory`. "Clear history" (`DELETE /ai/history`) deletes a user's rows, so the chart goes down when users clear their history. Only answered questions are recorded. A permanent fix (a soft-delete flag or a separate query log) is a schema decision.

## Google Drive integration

Users connect their Google Drive, pick files, and choose `allowed_roles` per file in the EKIP UI. EKIP downloads each file and ingests it with that access list. Drive's own permissions are ignored. EKIP's RBAC applies.

All routes need an access token and the Admin or Manager role, except the callback.

**GET /integrations/google/connect**
- 200: `{ "url" }`. The frontend opens this Google sign-in URL.

**GET /integrations/google/callback** (called by Google, not the frontend)
- Reads `code` and a signed `state` (a JWT that carries the user id, valid for 10 minutes, signed with `OAUTH_STATE_SECRET`).
- Redirects to `<frontend>/integrations?connected=google`, or `?error=access_denied` / `?error=connect_failed`.
- 400: invalid, tampered or expired `state`.

**GET /integrations/google/status**
- 200: `{ "connected": true | false }`

**GET /integrations/google/files** (optional `?page_token=`)
- 200: `{ "files": [{ id, name, mimeType, modifiedTime, size }], "next_page_token" }`. Only PDF, DOCX, XLSX and TXT files that are not in the trash are listed.
- 400: not connected, or `code: "GOOGLE_RECONNECT_REQUIRED"` (the stored connection expired and was deleted).

**POST /integrations/google/import**
- Body: `{ "files": [{ "file_id", "allowed_roles": ["Admin", "Manager"] }] }`, 1 to 5 files.
- Rules: `allowed_roles` must be a non-empty list of valid roles and must include the importer's own role.
- File name and type come from Drive, never from the request body. Files over 50 MB are skipped.
- 200: `{ "results": [{ file_id, filename, status: "success" | "error", error?, document_id? }] }`. One file failing does not fail the others.
- 400: invalid body, not connected, or `GOOGLE_RECONNECT_REQUIRED`.

**DELETE /integrations/google/disconnect**
- 200: `{ "message": "Google Drive disconnected." }`. The stored tokens are deleted.

### Design decisions
- Read-only scope (`drive.readonly`).
- Google tokens are encrypted before storage (AES-256-GCM, key in `TOKEN_ENCRYPTION_KEY`), and decrypted only when calling Google.
- The OAuth callback is the only route without a login token. Its identity comes from the signed `state`.
- Imports go through the same `ingestDocument` helper as normal uploads. The same `allowed_roles` list is saved in Postgres and sent to the AI service for the Qdrant chunks.
- In Google's Testing mode, a refresh token expires after 7 days. The app then returns `GOOGLE_RECONNECT_REQUIRED`.

## Rate limiting

Limits protect login and the AI service from abuse. When a limit is hit, the response is HTTP 429 with `{ "error": "...", "code": "RATE_LIMITED" }` and a `Retry-After` header (in seconds).

| Endpoint | Limit | Counted per | Env variable |
|---|---|---|---|
| POST /auth/login | 5 failed / 15 min | IP + email (successful logins are not counted) | `RATE_LIMIT_LOGIN_MAX` |
| POST /auth/login | 30 failed / 15 min | IP | `RATE_LIMIT_LOGIN_IP_MAX` |
| POST /auth/refresh | 20 / min | IP | `RATE_LIMIT_REFRESH_MAX` |
| POST /organizations | 3 / hour | IP | `RATE_LIMIT_SIGNUP_MAX` |
| POST /ai/ask | 30 / min | user | `RATE_LIMIT_QUERY_MAX` |
| POST /ai/ingest | 10 / min | user | `RATE_LIMIT_UPLOAD_MAX` |
| POST /integrations/google/import | 5 / min | user | `RATE_LIMIT_IMPORT_MAX` |

**Notes**
- The progress, history and document-list routes are not limited, because the UI polls them.
- Counters are kept in server memory, so they reset when the server restarts and are not shared between several backend instances.
- `trust proxy` is not enabled. If a reverse proxy is added in front of the backend, it must be configured, or every client appears with the proxy's IP.
- For demos, raise `RATE_LIMIT_SIGNUP_MAX`, since creating several organizations from one machine hits the limit quickly.

### Setup
Create an OAuth client in Google Cloud Console (Web application, redirect URI `http://localhost:5000/integrations/google/callback`), and add testers on the consent screen. `.env` needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` and `OAUTH_STATE_SECRET`. Generate the two secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### Local setup
`.env` needs `PORT`, `JWT_SECRET` and `DATABASE_URL`. Run `npx prisma migrate dev` to create the tables, then `node src/prisma/seed.js` to create the demo admin (set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` first).