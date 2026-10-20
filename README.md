# EKIP — Enterprise Knowledge Intelligence Platform

EKIP is a multi-tenant workspace for indexing organizational documents and
answering questions from their contents. It combines a React frontend, an
Express API, a FastAPI retrieval and generation service, PostgreSQL, Qdrant,
and a local Ollama model.

Questions are answered from documents the signed-in user is allowed to access.
The normal question-answering flow does not use public web search or a hosted
LLM API.

> **Current state:** this is a working prototype with known defects. Three
> verified issues affect the search path - see
> [Known issues](#known-issues) before you rely on it. The project status
> report is [`PROJECT_PROGRESS.md`](./PROJECT_PROGRESS.md), and the AI
> pipeline is documented in
> [`docs/08_AI_Handbook.md`](./docs/08_AI_Handbook.md).

## Contents

- [What EKIP does](#what-ekip-does)
- [Architecture and data](#architecture-and-data)
- [Start with Docker Desktop](#start-with-docker-desktop)
- [Create an account and use EKIP](#create-an-account-and-use-ekip)
- [Run services locally](#run-services-locally)
- [Configuration and ports](#configuration-and-ports)
- [Google Drive integration](#google-drive-integration)
- [Development and validation](#development-and-validation)
- [Known issues](#known-issues)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)

## What EKIP does

### Workspaces and members

An organization is created during signup, along with its first workspace,
department, and Admin account. Admins can view workspace details, rename a
workspace, inspect its departments and members, and see database-backed member,
department, and document totals.

### Document upload and processing

The Upload Documents page accepts PDF, DOCX, XLSX, and TXT files. The upload
status shows the ingestion stages, including page parsing, chunking, embedding,
and indexing. Members see documents available to their role and department.
Admins and permitted users can remove indexed documents from the interface.

Uploaded originals are retained in a private storage location to enable PDF
preview. Docker Compose uses the `document_uploads` named volume; a backend run
directly on Windows uses `apps/backend/uploads/`, which is ignored by Git.
Deleting a document removes its indexed chunks, database record, and retained
original. Older indexed documents whose original file was not retained must
be re-uploaded before a PDF preview can be opened.

### Search, citations, and history

Search retrieves authorized passages, reranks them, generates a concise answer,
and returns citations. Search shows the active question and processing stage;
it does not display private model reasoning. Source citations identify their
document and page. For a retained PDF, **Preview PDF at page N** opens the
original at the cited page. DOCX, XLSX, and TXT citations do not have a PDF
preview.

Questions and completed answers are stored per user in PostgreSQL and restored
when Search is reopened. The conversation keeps the newest exchange at the
bottom; the message history scrolls independently, while the composer stays
fixed at the bottom of the Search view.

### Supported input formats

| Format | Current extraction support |
| --- | --- |
| PDF | Text-based PDFs; scanned/image-only pages fall back to EasyOCR before ColPali routing |
| DOCX | Word paragraphs and tables |
| XLSX | Spreadsheet content |
| TXT | Plain text |

PPTX and CSV are not currently supported.

### Google Drive import

The backend can connect a Google Drive account, list PDF/DOCX/XLSX/TXT files,
and import them into a workspace with a per-file role list. There is no
frontend for this yet - it is currently API-only. See
[Google Drive integration](#google-drive-integration).


## Architecture and data

```text
Browser
  └── React + Vite frontend ── http://localhost:5173
       └── Express backend ─── http://localhost:5000
            ├── PostgreSQL ── accounts, workspaces, documents, chat history
            └── FastAPI AI ── http://localhost:8000
                 ├── Qdrant ── indexed passages and vectors
                 └── Ollama ── local llama3.2:3b model
```

| Service | Responsibility | Host port |
| --- | --- | ---: |
| Frontend | React application and UI | 5173 |
| Backend | Authentication, workspace administration, document APIs, AI proxy, Google Drive | 5000 |
| PostgreSQL | Accounts, workspace records, document metadata, answer history | 5432 |
| AI service | Ingestion, retrieval, reranking, generation, citations | 8000 |
| Qdrant | Document chunks and vector search | 6333 |
| Ollama | Local language model runtime | 11434 |

A second FastAPI service, the visual AI service (ColPali + Qwen2-VL), exists
in `apps/ai-service-visual` and targets port 8001. It is **not** part of the
Compose stack and has no Dockerfile, so it does not run by default. See
[Known issues](#known-issues).

The AI service, Qdrant, and Ollama are in the Compose `ai` profile. The
backend validates JWTs and supplies organization, workspace, department, and
role context to protected operations. Retrieval applies these access fields
before returning passages.

Docker Compose persists PostgreSQL, Qdrant, Ollama models, and original
uploads in named volumes. `docker compose down` keeps those volumes.
`docker compose down -v` removes them, including user data, indexed content,
answer history, retained uploads, and model weights.

## Start with Docker Desktop

### Requirements

- Windows 10/11 with Docker Desktop using the Linux/WSL 2 engine.
- Git and a browser.
- Internet access for initial image, package, model, and embedding/reranking
  model downloads.
- Several gigabytes of disk space for AI dependencies and model weights.

Node.js and Python do not need to be installed on Windows when using Compose.

### 1. Clone and open the repository

In PowerShell:

```powershell
git clone https://github.com/Jnanamithran/ekip-platform.git
Set-Location ekip-platform
docker info
docker compose version
```

Docker Desktop must be running before you start the stack.

### 2. Set the root JWT secret

Create a private `.env` file in the repository root with a random
`JWT_SECRET`. For example:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes)
$rng.Dispose()
Set-Content -Path .env -Value "JWT_SECRET=$secret" -Encoding ASCII
```

Do not commit `.env` or share its secret. `.env` is ignored by Git.

### 3. Build and start all services

```powershell
docker compose --profile ai up --build -d
docker compose ps
```

The backend applies pending Prisma migrations at startup. Wait for PostgreSQL
and the backend health checks to report healthy. AI images and Python
dependencies can take several minutes to build for the first time.

### 4. Download the Ollama model

Download the configured model into its persistent volume:

```powershell
docker compose exec ollama ollama pull llama3.2:3b
docker compose exec ollama ollama list
```

Model downloads are needed once per Ollama data volume. The AI service may also
download embedding and reranking model weights on its first run.

### 5. Open EKIP

- Signup: <http://localhost:5173/signup>
- Login: <http://localhost:5173/login>
- Backend health: <http://localhost:5000/health>
- AI health: <http://localhost:8000/health>
- Qdrant dashboard: <http://localhost:6333/dashboard>

After signup, upload documents before asking questions about their content.

## Create an account and use EKIP

1. Open Signup and create an organization, workspace, department, and first
   Admin account.
2. Sign in using that Admin account.
3. Upload a supported document and wait until indexing completes.
4. Ask a question on Search. The current processing stage is displayed while
   the system works. Use **Clear chat** to erase your saved question history.
5. Open a citation’s source to inspect its excerpt, then select **Preview PDF
   at page N** when the original PDF is available.
6. Open Workspace Settings to review the workspace overview, member list,
   department/document totals, and rename the workspace.

Only Admin users can open Workspace Settings and Manage Users. Workspace
member, department, and document counts come from PostgreSQL.

The Manage Users page is currently a **read-only list**. The backend supports
creating, editing, deactivating, reactivating users and resetting passwords,
but those controls are not exposed in the UI yet.

Uploads currently set the document's role list to the uploader's own role.
Per-document multi-role access is only reachable through the Google Drive
import API.

## Run services locally

This development setup runs PostgreSQL, Qdrant, and Ollama in Docker while
running the application code on Windows. Do not run Docker and local versions
of the same frontend/backend services at the same time; both use the same host
ports.

### 1. Start infrastructure

From the repository root:

```powershell
docker compose --profile ai up -d postgres qdrant ollama
docker compose exec ollama ollama pull llama3.2:3b
```

### 2. Configure and start the backend

Create `apps/backend/.env` with a private JWT secret and a database URL for
local Windows access:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ekip?schema=public
JWT_SECRET=replace-with-a-private-random-secret
PORT=5000
AI_SERVICE_URL=http://localhost:8000
QDRANT_URL=http://localhost:6333
UPLOAD_STORAGE_DIR=uploads
FRONTEND_ORIGINS=http://localhost:5173
```

Then run:

```powershell
Set-Location apps/backend
npm ci
npx prisma generate --schema src/prisma/schema.prisma
npx prisma migrate deploy --schema src/prisma/schema.prisma
npm run dev
```

### 3. Configure and start the AI service

In another PowerShell window:

```powershell
Set-Location apps/ai-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
$env:QDRANT_URL = "http://localhost:6333"
$env:OLLAMA_URL = "http://localhost:11434"
$env:BACKEND_URL = "http://localhost:5000"
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Configure and start the frontend

In another PowerShell window:

```powershell
Set-Location apps/frontend
npm ci
```

Create `apps/frontend/.env`:

```dotenv
VITE_API_URL=http://127.0.0.1:5000
```

Start Vite:

```powershell
npm run dev
```

Open <http://localhost:5173>. Port 5173 is the frontend port both locally and
in Docker Compose. The browser calls the backend on port 5000.

### Optional: the visual AI service

The visual service is not needed for the text pipeline. To run it, follow
[`docs/08_AI_Handbook.md`](./docs/08_AI_Handbook.md#running-the-services). It
needs a CUDA-capable GPU for practical use, and it is not reachable from the
Compose stack.

### Host and container addresses

Within the Compose network, use service names:

- Backend → PostgreSQL: `postgres:5432`
- Backend → AI service: `ai-service:8000`
- AI service → Qdrant: `qdrant:6333`
- AI service → Ollama: `ollama:11434`
- AI service → backend progress API: `backend:5000`

On Windows, local processes use `localhost`/`127.0.0.1` and the published host
ports. The browser's `VITE_API_URL` must point to the host backend, not the
Compose-only service name.

## Configuration and ports

| Setting | Used by | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | Backend | Signs and verifies access tokens |
| `DATABASE_URL` | Backend / Prisma | PostgreSQL connection string |
| `AI_SERVICE_URL` | Backend | AI service base URL |
| `QDRANT_URL` | Backend and AI service | Qdrant endpoint |
| `OLLAMA_URL` | AI service | Ollama endpoint |
| `BACKEND_URL` | AI service | Reports processing stages |
| `UPLOAD_STORAGE_DIR` | Backend | Private retained originals |
| `FRONTEND_ORIGINS` | Backend | Allowed browser origin(s) |
| `VITE_API_URL` | Frontend build/dev server | Backend URL used by the browser |

Do not publish secrets in source code, issue reports, or screenshots.

The AI service also reads `VISUAL_SERVICE_URL` (default
`http://ai-service-visual:8001`) for the visual pipeline. The visual service
reads `COLPALI_MODEL`, `QWEN_MODEL`, `RENDER_DPI` and `VISUAL_STORAGE`.

## Google Drive integration

The backend can import documents from a connected Google Drive account. This
is **API-only at present** - there is no `/integrations` page in the frontend
yet, so the flow must be driven with an HTTP client or `curl`.

All routes require an access token and the `Admin` or `Manager` role, except
the OAuth callback.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/integrations/google/connect` | Returns the Google sign-in URL to open |
| `GET` | `/integrations/google/callback` | Google redirects here; exchanges the code |
| `GET` | `/integrations/google/status` | `{ "connected": true \| false }` |
| `GET` | `/integrations/google/files` | Lists PDF/DOCX/XLSX/TXT files, not trashed |
| `POST` | `/integrations/google/import` | Imports 1-5 files with per-file role lists |
| `DELETE` | `/integrations/google/disconnect` | Deletes the stored connection |

The import body is `{ "files": [{ "file_id", "allowed_roles": ["Admin", "Manager"] }] }`.
`allowed_roles` must be a non-empty list of valid roles and must include the
importer's own role. File names and types come from Drive, never from the
request body. Files over 50 MB are skipped, and one file failing does not fail
the others.

Drive's own permissions are ignored - EKIP's RBAC applies. Imported files go
through the same ingestion path as a normal upload, and the same role list is
saved in Postgres and sent to the AI service for the Qdrant chunks.

### Setup

1. Create an OAuth client in Google Cloud Console (Web application, redirect URI
   `http://localhost:5000/integrations/google/callback`) and add testers on the
   consent screen.
2. Add these to `apps/backend/.env` (and to the Compose `backend` service
   environment, which does not set them for you):

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:5000/integrations/google/callback
TOKEN_ENCRYPTION_KEY=64-hex-characters
OAUTH_STATE_SECRET=64-hex-characters
```

Generate the two secrets with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Google tokens are encrypted at rest with AES-256-GCM using
`TOKEN_ENCRYPTION_KEY`. In Google's Testing mode a refresh token expires after
7 days; the API then returns `GOOGLE_RECONNECT_REQUIRED`.


## Development and validation

Frontend build and lint:

```powershell
npm --prefix apps/frontend run build
npm --prefix apps/frontend run lint
```

Backend JavaScript syntax checks:

```powershell
Set-Location apps/backend
node --check src/controllers/admin.controller.js
node --check src/controllers/ai.controller.js
node --check src/routes/admin.routes.js
node --check src/routes/ai.routes.js
```

Prisma checks:

```powershell
Set-Location apps/backend
npx prisma validate --schema src/prisma/schema.prisma
npx prisma generate --schema src/prisma/schema.prisma
```

AI service tests (install the project requirements and pytest in the active
Python environment if needed):

```powershell
Set-Location apps/ai-service
python -m pytest tests -q
```

The current result is **13 passed, 4 collection errors**. The four failing
modules are `test_citations.py`, `test_generation.py`, `test_hybrid.py` and
`test_reranker.py` - see [Known issues](#known-issues).

Useful Compose commands from the repository root:

```powershell
docker compose ps
docker compose logs --tail 100 backend
docker compose logs --tail 100 ai-service
docker compose logs --tail 100 frontend
docker compose down
```

## Known issues

These were verified against `main` at commit `f4c217b`. The first two are
defects in the AI service; the third is a wiring gap. Full detail is in
[`docs/08_AI_Handbook.md`](./docs/08_AI_Handbook.md#known-issues-and-blockers).

### 1. `MatchValue` is not imported - the BM25 path of every `/ask` fails

`apps/ai-service/retrieval/rbac_filter.py` imports `Filter, FieldCondition,
MatchAny` but calls `MatchValue` three times without importing it, so
`fetch_authorized_chunks()` raises `NameError: name 'MatchValue' is not
defined`. Because `hybrid_retrieve()` calls `sparse_retrieve()`, which calls
that function, the sparse half of hybrid retrieval fails on every `/ask`.

**Fix:** add `MatchValue` to the import in `rbac_filter.py`.

### 2. The visual collection does not exist, so `/ask` returns HTTP 500

`has_visual_docs()` in `apps/ai-service/main.py` scrolls the Qdrant
collection `ekip_visual_documents` on every `/ask` request. That collection is
only created by the visual service, which is not in the Compose stack. Qdrant
answers a scroll on a missing collection with 404, `qdrant-client` raises
`UnexpectedResponse`, and nothing catches it - so `/ask` fails with a 500
before retrieval begins.

The test suite does not catch this because `test_ask_endpoint.py`
monkeypatches `has_visual_docs` to return `False`.

**Fix:** check `client.collection_exists(...)` first, or catch the 404 and
treat it as "no visual documents".

### 3. Four AI-service test modules fail at collection

`test_citations.py`, `test_generation.py`, `test_hybrid.py` and
`test_reranker.py` build `RBACContext(...)` at import time without the
required `allowed_roles` field, so pytest aborts with a pydantic
`ValidationError`.

**Fix:** add `allowed_roles=[...]` to each construction and move it into a
fixture.

### 4. The visual pipeline is never triggered

Even with the 404 handled, nothing calls `POST /visual/ingest`, the visual
service has no Dockerfile, and it is absent from `docker-compose.yml`. The
visual collection therefore stays empty and only the text pipeline runs.

### 5. Frontend gaps

- No Google Drive page - the backend integration is unreachable from the UI.
- Manage Users is read-only; create/edit/deactivate/reset-password have no
  UI.
- No multi-role control on upload; every uploaded document is visible only to
  the uploader's role.


## Troubleshooting

### Port 5173, 5000, or another service port is already in use

Only run one frontend and one backend on each host port at a time. Stop the
duplicate local process from its own terminal, or stop the corresponding
Compose service before starting the local version. Do not terminate a process
unless you have confirmed what it is.

### The frontend cannot connect to the backend

Check that the backend is running on port 5000 and that `VITE_API_URL` points
to `http://127.0.0.1:5000` (or `http://localhost:5000`). The configured
`FRONTEND_ORIGINS` must include `http://localhost:5173`.

```powershell
curl.exe http://127.0.0.1:5000/health
docker compose ps
docker compose logs --tail 100 backend
```

### Search or upload says the AI service is unavailable

Start the `ai` profile and check AI service, Ollama, and Qdrant logs:

```powershell
docker compose --profile ai up -d
docker compose ps
docker compose logs --tail 100 ai-service ollama qdrant
docker compose exec ollama ollama list
```

If the model is missing, run `docker compose exec ollama ollama pull
llama3.2:3b`.

### Search fails with a 500

Check the AI service log first. Two known defects produce a 500 on the search
path - the missing `MatchValue` import and the missing visual collection.
Both are described in [Known issues](#known-issues).

```powershell
docker compose logs --tail 100 ai-service
```

### A PDF citation cannot be previewed

Preview requires a retained original PDF. Older indexed documents may have
chunks in Qdrant but no original file; re-upload the PDF to enable preview.
Only authorized users can fetch a retained PDF.

### Prisma reports a missing `DATABASE_URL`

Compose supplies the database URL inside the backend container. A Prisma
command run directly on Windows does not inherit Compose variables; create
`apps/backend/.env` with the local connection settings in
[Run services locally](#run-services-locally).

### Remove all local Docker data

`docker compose down` stops and removes containers but leaves named volumes.
`docker compose down -v` permanently deletes database rows, indexed vectors,
retained uploads, and Ollama model files. Use it only when you intentionally
want a full local reset.

## Project layout

```text
ekip-platform/
├── apps/
│   ├── frontend/          # React, Vite, Tailwind
│   ├── backend/           # Express API, JWT auth, Prisma schema/migrations
│   ├── ai-service/        # FastAPI, ingestion, retrieval, citations, generation
│   └── ai-service-visual/ # FastAPI, ColPali + Qwen2-VL (not in Compose)
├── docs/                  # Deployment and project documentation
├── docker-compose.yml     # Local service stack and persistent volumes
├── PROJECT_PROGRESS.md    # Current project status
└── README.md
```
