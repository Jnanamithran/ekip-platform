# Backend Handbook

The backend is the Express application in `apps/backend`. It owns identity,
organization scoping, application APIs, PostgreSQL access through Prisma, and
the proxy between the browser and AI service.

## Local setup

Install Node.js, run PostgreSQL, and create the `ekip` database. Create
`apps/backend/.env` using the example file as a guide:

```dotenv
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/ekip?schema=public"
JWT_SECRET=use-a-long-private-random-value
PORT=5000
AI_SERVICE_URL=http://localhost:8000
QDRANT_URL=http://localhost:6333
UPLOAD_STORAGE_DIR=uploads
FRONTEND_ORIGINS=http://localhost:5173
```

From the backend directory:

```powershell
npm ci
npx prisma generate --schema src/prisma/schema.prisma
npx prisma migrate deploy --schema src/prisma/schema.prisma
npm run dev
```

The package scripts are `dev` (nodemon), `start` (Node), and `test` (Jest).
Compose applies migrations before starting the backend container.

## Authentication and roles

The API uses signed access JWTs and rotating refresh tokens. The backend
verifies access tokens and attaches user, organization, workspace, department,
and role information to the request. Protected AI requests forward the
validated identity context to the AI service.

Roles defined in the backend Prisma schema:

| Role | Typical purpose |
| --- | --- |
| `Admin` | Organization administration and user/workspace management |
| `Manager` | Authorized document and Google Drive operations |
| `Employee` | Standard workspace access |
| `Intern` | Restricted standard workspace access |

Protected route groups apply authentication middleware. Admin endpoints also
require the Admin role. Google Drive endpoints require Admin or Manager except
the OAuth callback, whose identity is checked using signed OAuth state.

### Authentication endpoints

| Method and path | Purpose |
| --- | --- |
| `POST /organizations` | Create organization, initial workspace/department, and first Admin |
| `POST /auth/login` | Verify credentials and issue tokens |
| `POST /auth/refresh` | Rotate a refresh token |
| `POST /auth/logout` | Revoke a refresh token |
| `GET /auth/me` | Return the authenticated user's identity |

Password policy and account lockout are enforced when setting credentials and
logging in. Refresh tokens are stored hashed, and successful refresh replaces
the previous token.

## Main API surface

### Admin APIs

All `/admin` endpoints require an authenticated Admin:

| Method and path | Purpose |
| --- | --- |
| `GET /admin/analytics/queries` | Organization query counts for recent days |
| `GET`, `POST /admin/users` | List or create users |
| `PATCH /admin/users/:id` | Update user details |
| `POST /admin/users/:id/reset-password` | Reset a user's password |
| `PATCH /admin/users/:id/deactivate` | Deactivate a user |
| `PATCH /admin/users/:id/reactivate` | Reactivate a user |
| `GET`, `POST /admin/workspaces` | List or create workspaces |
| `GET /admin/workspaces/:workspaceId` | Workspace dashboard data |
| `PATCH /admin/workspaces/:workspaceId` | Update workspace |
| `GET`, `POST /admin/departments` | List or create departments |

The backend enforces organization boundaries for administration. The frontend
may expose only a subset of the backend's administrative controls.

### AI and document APIs

Protected `/ai` endpoints include:

| Method and path | Purpose |
| --- | --- |
| `POST /ai/ask` | Ask a question against authorized content |
| `POST /ai/ask/progress`, `GET /ai/ask/progress/:requestId` | Report/read answer progress |
| `GET /ai/history`, `DELETE /ai/history` | List or clear the current user's answer history |
| `POST /ai/ingest` | Upload and index a document |
| `POST /ai/documents/:id/reindex` | Reprocess a retained document; Admin or Manager |
| `GET /ai/documents` | List documents visible to the current user |
| `GET /ai/documents/:id/preview` | Stream an authorized retained original |
| `GET /ai/documents/:id/page-image/:page_num` | Stream a rendered visual-page image |
| `DELETE /ai/documents/:id` | Delete an authorized document and indexed data |
| `GET /ai/health` | Check the AI service connection |

Uploads have a 50 MB limit. User and tenant fields come from the authenticated
context; clients must not be allowed to assign themselves another tenant's
permissions.

### Google Drive APIs

Google Drive integration is available through the frontend Integrations page
and these backend routes:

| Method and path | Purpose |
| --- | --- |
| `GET /integrations/google/connect` | Start OAuth connection |
| `GET /integrations/google/callback` | OAuth redirect callback |
| `GET /integrations/google/status` | Check connection status |
| `GET /integrations/google/files` | List supported Drive files |
| `POST /integrations/google/import` | Import files with EKIP role access |
| `DELETE /integrations/google/disconnect` | Remove the connection |

Import accepts PDF, DOCX, XLSX, or TXT files. Drive sharing permissions are
not copied; EKIP's selected roles control access. Configure Google OAuth
credentials and encryption/state secrets only when enabling the integration.

## Rate limiting and security behavior

The backend includes request limits for login, refresh, signup, AI queries,
uploads, and Drive imports. Limits and policy configuration are documented in
`apps/backend/.env.example` and enforced by middleware.

Additional behaviors include account lockout after repeated failed logins,
password-policy checks, deactivation, hashed rotating refresh tokens, scoped
document access, and encryption for stored Google OAuth tokens. These controls
do not replace a production security review, HTTPS, centralized rate limiting,
or operational monitoring.

## Database and migrations

Prisma schema: `src/prisma/schema.prisma`

Migrations: `src/prisma/migrations/`

For normal startup or a clean local install:

```powershell
npx prisma generate --schema src/prisma/schema.prisma
npx prisma migrate deploy --schema src/prisma/schema.prisma
```

When intentionally creating a schema migration during development, use Prisma
migration tooling and commit the resulting migration directory with the schema
change. Do not edit a deployed migration in place.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Access-token signing secret |
| `PORT` | No | HTTP port; defaults to 5000 in the project setup |
| `AI_SERVICE_URL` | No | Text AI service base URL |
| `QDRANT_URL` | No | Qdrant URL for document operations |
| `FRONTEND_ORIGINS` | No | Comma-separated allowed frontend origins |
| `UPLOAD_STORAGE_DIR` | No | Private retained upload directory |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Drive only | Google OAuth client |
| `TOKEN_ENCRYPTION_KEY` | Drive only | Encrypts tokens at rest |
| `OAUTH_STATE_SECRET` | Drive only | Signs OAuth state |

See [`.env.example`](../apps/backend/.env.example) for other rate-limit and
OAuth settings. Never put real values in documentation, screenshots, or
commits.

## Testing

From `apps/backend`:

```powershell
npm ci
npm test
```

The test suite is in `apps/backend/tests`. Validate the Prisma schema with:

```powershell
npx prisma validate --schema src/prisma/schema.prisma
```
