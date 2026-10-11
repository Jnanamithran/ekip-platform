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

**POST /auth/refresh**
- Body: `{ "refresh_token": "..." }`
- 200: a new `access_token` and a new `refresh_token`. The old refresh token is deleted, so it cannot be used again.
- 400: `refresh_token` missing
- 401: invalid or expired refresh token

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

### Middleware
- `authenticate`: verifies the access token and attaches `req.user` (the five fields above). Returns 401 if the token is missing or invalid.
- `requireRole(...roles)`: used after `authenticate`. Returns 403 if `req.user.role` is not in the list.
- All routes under `/admin` use both, applied once in `admin.routes.js`.

### AI service context
Query time sends `org_id`, `workspace_id`, `department_id` and `role`. Document upload sends `org_id`, `workspace_id`, `department_id`, `allowed_roles` and `uploaded_by`. All values come from `req.user`. (Upload and query routes are not built yet.)

### Local setup
`.env` needs `PORT`, `JWT_SECRET` and `DATABASE_URL`. Run `npx prisma migrate dev` to create the tables, then `node src/prisma/seed.js` to create the demo admin (set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` first).