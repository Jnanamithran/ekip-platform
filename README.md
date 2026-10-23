# EKIP

EKIP (Enterprise Knowledge Intelligence Platform) is a local-first document
workspace. Users upload organizational documents, and the application answers
questions using content the signed-in user is authorized to access. The project
combines a React frontend, an Express/Prisma backend, PostgreSQL, a FastAPI AI
service, Qdrant, and Ollama.

This is a development prototype, not a production-hardened service. Review
[known limitations](#known-limitations) before using it with sensitive or
business-critical data.

## Contents

- [Architecture](#architecture)
- [Run everything locally without Docker](#run-everything-locally-without-docker)
- [Docker-based setup (optional)](#docker-based-setup-optional)
- [Use EKIP](#use-ekip)
- [Configuration](#configuration)
- [Tests and checks](#tests-and-checks)
- [Known limitations](#known-limitations)
- [Project documentation](#project-documentation)

## Architecture

```text
Browser
  └── React + Vite frontend :5173
         └── Express + Prisma backend :5000
              ├── PostgreSQL :5432
              └── FastAPI AI service :8000
                   ├── Qdrant :6333
                   ├── Ollama :11434
                   └── Optional visual AI service :8001
```

The text AI pipeline parses and chunks PDF, DOCX, XLSX, and TXT files; indexes
authorized chunks in Qdrant; retrieves and reranks relevant content; and asks a
local Ollama model to produce an answer with citations. The visual service
provides a separate scanned-page pipeline using ColPali and Qwen2-VL.

| Service | Host port | Purpose |
| --- | ---: | --- |
| Frontend | 5173 | React application |
| Backend | 5000 | Authentication, workspace and document APIs, AI proxy |
| PostgreSQL | 5432 | Accounts, workspace/document metadata, answer history |
| Text AI service | 8000 | Ingestion, retrieval, generation and citations |
| Qdrant | 6333 | Text and visual document indexes |
| Ollama | 11434 | Local `llama3.2:3b` language model |
| Visual AI service | 8001 | Optional scanned-page ingestion and visual QA |
## Docker-based setup (optional)

### Requirements

- Windows 10/11 with Docker Desktop using its Linux/WSL 2 engine.
- Git and a web browser.
- Internet access and several GB of free space for images, Python dependencies,
  and model files.
- NVIDIA GPU support configured for Docker if you want to start the optional
  visual service in the Compose `ai` profile.

Node.js and Python are not required on the host for the Compose setup.

### Start

From PowerShell, at the repository root:

```powershell
docker info
```

Compose requires a private root `.env` file with a `JWT_SECRET` and
`AI_SERVICE_API_KEY`. For a new setup, create both values with:

```powershell
if (-not (Test-Path .env)) {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes)
    $rng.GetBytes($bytes)
    $aiKey = [Convert]::ToBase64String($bytes)
    $rng.Dispose()
    Set-Content -Path .env -Value "JWT_SECRET=$secret`nAI_SERVICE_API_KEY=$aiKey" -Encoding ASCII
}
```

If `.env` already exists, add a separately generated random
`AI_SERVICE_API_KEY` value to it before starting Compose. Keep this key private;
the backend and both AI services use it to authenticate internal requests.

Build and start the full Compose profile:

```powershell
docker compose --profile ai up --build -d
docker compose ps
```

The first build can take several minutes. After Ollama starts, download the
configured model into its persistent volume:

```powershell
docker compose exec ollama ollama pull llama3.2:3b
```

Wait for PostgreSQL and the AI services to become healthy, then continue:

```powershell
docker compose ps
```
## Project documentation

- [Project progress](PROJECT_PROGRESS.md)
- [Project handbook](docs/01_Project_Handbook.md)
- [System architecture](docs/05_System_Architecture.md)
- [Backend handbook](docs/06_Backend_Handbook.md)
- [AI handbook](docs/08_AI_Handbook.md)
- [Deployment handbook](docs/10_Deployment_Handbook.md)
- [Project roadmap](docs/11_Project_Roadmap.md)
## Known limitations

- This is a prototype; production deployment, operational monitoring, backup
  and recovery, and independent security review are not complete.
- The current user model grants access within one workspace. Additional
  department grants do not grant access to another workspace.
- Department-scoped roles are limited to their department. Document access
  requires both access to the document's department and a matching allowed
  role, except for the organization Owner, who has protected Owner access.
- Scanned-PDF visual processing requires the optional visual model stack and
  substantial compute resources. Text extraction/OCR behavior depends on the
  document and installed model/runtime support.
- Supported upload formats are PDF, DOCX, XLSX, and TXT. PPTX and CSV are not
  supported.
- Google Drive import uses EKIP role-based permissions; you can import
  individual files or entire folders and choose which organization roles can
  search each imported file. Organization-wide roles and roles matching each
  item's target department are offered. It does not preserve Drive sharing
  permissions.
- PDF preview requires the original file to be retained. Other supported
  formats provide text citations, not PDF previews.
## Tests and checks

Frontend build and lint:

```powershell
npm --prefix apps/frontend run build
npm --prefix apps/frontend run lint
```

Backend tests and Prisma checks:

```powershell
Set-Location .\apps\backend
npm ci
npm test
npx prisma validate --schema src/prisma/schema.prisma
```

AI service tests:

```powershell
Set-Location .\apps\ai-service
python -m pytest tests -q
```

The text AI suite includes Qdrant integration tests and requires local Qdrant
on port 6333. Four legacy pipeline demo scripts are excluded from pytest
collection because they call live Qdrant/Ollama at import time. See
[AI Handbook: tests](docs/08_AI_Handbook.md#tests).

Visual AI service tests (API behavior and RBAC, without model downloads or Docker):

```powershell
Set-Location .\apps\ai-service-visual
.\.venv\Scripts\python.exe -m pip install pytest
.\.venv\Scripts\python.exe -m pytest tests -q
```

To apply database migrations to an existing development database, run
`npx prisma migrate deploy` from `apps/backend`. The default-department
migration marks an existing `General` department as the workspace default
when available, otherwise marks the first existing department; it creates a
`General` department only for a workspace that has none.
## Configuration

| Variable | Used by | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | Backend | Signs access tokens |
| `DATABASE_URL` | Backend / Prisma | PostgreSQL connection string |
| `AI_SERVICE_URL` | Backend | Text AI service address |
| `AI_SERVICE_API_KEY` | Backend, text AI, visual AI | Shared key for service-to-service authentication |
| `QDRANT_URL` | Backend and AI services | Qdrant address |
| `OLLAMA_URL` | Text AI service | Ollama address |
| `BACKEND_URL` | Text AI service | Reports processing progress |
| `FRONTEND_ORIGINS` | Backend | Allowed browser origin(s) |
| `VITE_API_URL` | Frontend | Backend address used by the browser |
| `VISUAL_SERVICE_URL` | Text AI service | Optional visual AI address |

Example files are provided in the individual application directories. Never
commit `.env` files, credentials, or API keys.

Google Drive OAuth is optional and requires a Google OAuth client. See
[Google Drive integration](docs/06_Backend_Handbook.md#google-drive-apis).
## Use EKIP

1. On Signup, provide the organization name, default workspace name, default
   department name, and first Owner account details. The default department
   cannot be deleted, though an authorized administrator can rename it. The
   Owner role is permanent — it cannot be changed, transferred, or deleted.
2. Sign in and upload a PDF, DOCX, XLSX, or TXT file.
3. Wait for processing/indexing to finish, then ask a question on Search.
4. Review source citations. PDF page previews are available when an original
   PDF is retained.
5. Members whose role grants the relevant permissions can review workspace
   settings and manage users. Create custom roles from the Manage Roles page;
   each role can be organization-wide or limited to one department.
6. When uploading or importing documents, choose the target department and
   allowed roles. The role picker offers organization-wide roles and
   department-specific roles belonging to the selected department. The
   backend validates this match as well. The protected Owner role is always
   included in document access selections and cannot be unchecked.
7. Connect Google Drive from Integrations to import individual files or
   folders. Each selected item can have its own department and matching role
   access.
## Run everything locally without Docker

Use the step-by-step Windows [local running guide](LOCAL_RUNNING.md) as the
canonical setup for PostgreSQL, Qdrant, Ollama, the backend, both AI services,
and the frontend. It runs services directly on the host and does not use
Docker. The visual AI service additionally needs its model weights and a
CUDA-capable GPU for full inference.

This section describes running each component directly on your host machine
without using Docker Compose. This is useful for development, debugging, or
when Docker resources are limited.

### Prerequisites

- **Node.js** (v18 or higher) for the frontend and backend
- **Python** (3.11 or higher) for the AI service
- **PostgreSQL** running and accessible
- **Qdrant** running (local or remote)
- **Ollama** running locally with `llama3.2:3b` model pulled
- Optional: **Ollama visual** with ColPali/Qwen2-VL models for visual AI

### Environment setup

Create `.env` files in each application directory. Example files are provided
in the individual application directories.

**Root `.env` (or set these as environment variables):**

```
JWT_SECRET=your-jwt-secret
DATABASE_URL=postgresql://ekip_user:ekip_password@localhost:5432/ekip
AI_SERVICE_URL=http://localhost:8000
QDRANT_URL=http://localhost:6333
OLLAMA_URL=http://localhost:11434
BACKEND_URL=http://localhost:5000
FRONTEND_ORIGINS=http://localhost:5173
VITE_API_URL=http://localhost:5000
VISUAL_SERVICE_URL=http://localhost:8001 (optional)
```

**Frontend (`apps/frontend/.env`):**

```
VITE_API_URL=http://localhost:5000
```

**Backend (`apps/backend/.env`):**

```
JWT_SECRET=your-jwt-secret
DATABASE_URL=postgresql://ekip_user:ekip_password@localhost:5432/ekip
AI_SERVICE_URL=http://localhost:8000
QDRANT_URL=http://localhost:6333
OLLAMA_URL=http://localhost:11434
BACKEND_URL=http://localhost:5000
FRONTEND_ORIGINS=http://localhost:5173
VITE_API_URL=http://localhost:5000
VISUAL_SERVICE_URL=http://localhost:8001 (optional)
```

### Running each service individually

#### 1. Start PostgreSQL

If you don't already have PostgreSQL running:

**Windows:** Install PostgreSQL and start the service:
```powershell
# Start PostgreSQL service
net start postgresql-x64-18
```

#### 2. Start Qdrant

```powershell
Set-Location "$env:USERPROFILE\Desktop"
.\qdrant.exe
```

Qdrant listens on port 6333. For storage configuration and safe reset
instructions, see [LOCAL_RUNNING.md](LOCAL_RUNNING.md).

#### 3. Start Ollama

Ensure Ollama is installed and the `llama3.2:3b` model is pulled:

```powershell
# If Ollama not running, start it
ollama serve

# Pull the model if not already installed
ollama pull llama3.2:3b
```

#### 4. Start the Backend

```powershell
Set-Location .\apps\backend
npm ci
npx prisma migrate deploy --schema src/prisma/schema.prisma
npm run dev
```

The backend will run at `http://localhost:5000`.

#### 5. Start the AI Service

```powershell
Set-Location .\apps\ai-service
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

The AI service will run at `http://localhost:8000`.

#### 6. Start the Frontend

```powershell
Set-Location .\apps\frontend
npm ci
npm run dev
```

The frontend will be available at `http://localhost:5173`.

#### 7. Start the optional visual AI service

The visual service requires ColPali and Qwen model weights, a compatible
environment, and a CUDA-capable GPU for practical inference. Follow the
visual-service setup in [LOCAL_RUNNING.md](LOCAL_RUNNING.md), then run:

```powershell
Set-Location .\apps\ai-service-visual
.\.venv\Scripts\activate
python -m uvicorn main:app --host 0.0.0.0 --port 8001
```

### Verification

After starting all services:

1. Visit `http://localhost:5173` in your browser
2. Sign up for a new account (or use existing credentials)
3. Upload a supported document (PDF, DOCX, XLSX, or TXT)
4. Wait for processing/indexing to complete
5. Ask a question on the search page
6. Review cited answers and source references