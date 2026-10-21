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
- [Run everything with Docker](#run-everything-with-docker)
- [Run application code locally without Docker](#run-application-code-locally-without-docker)
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
## Run everything with Docker

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

Compose requires a private root `.env` file with a `JWT_SECRET`. Create one if
you do not already have it; this command leaves an existing file untouched:

```powershell
if (-not (Test-Path .env)) {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes)
    $rng.Dispose()
    Set-Content -Path .env -Value "JWT_SECRET=$secret" -Encoding ASCII
}
```

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
- Scanned-PDF visual processing requires the optional visual model stack and
  substantial compute resources. Text extraction/OCR behavior depends on the
  document and installed model/runtime support.
- Supported upload formats are PDF, DOCX, XLSX, and TXT. PPTX and CSV are not
  supported.
- Google Drive import uses EKIP role-based permissions; you can import
  individual files or entire folders and choose which organization roles can
  search each imported file. It does not preserve Drive sharing permissions.
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

Some AI tests use live Qdrant or Ollama dependencies; check their fixtures and
test markers before running them without those services. See
[AI Handbook: tests](docs/08_AI_Handbook.md#tests).
## Configuration

| Variable | Used by | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | Backend | Signs access tokens |
| `DATABASE_URL` | Backend / Prisma | PostgreSQL connection string |
| `AI_SERVICE_URL` | Backend | Text AI service address |
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

1. Create an organization, workspace, department, and first Owner account on
   the Signup page. The Owner role is permanent — it cannot be changed,
   transferred, or deleted.
2. Sign in and upload a PDF, DOCX, XLSX, or TXT file.
3. Wait for processing/indexing to finish, then ask a question on Search.
4. Review source citations. PDF page previews are available when an original
   PDF is retained.
5. Members whose role grants the relevant permissions can review workspace
   settings and manage users. Create additional custom roles (and choose what
   each can do) from the Manage Roles page. The backend also provides a Google
   Drive integration; connect Drive, then import individual files or whole
   folders from the Integrations page.
## Run application code locally without Docker

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
net start postgresql
```

**Or using Docker (one-off):**
```powershell
docker run -d -e POSTGRES_DB=ekip -e POSTGRES_USER=ekip_user -e POSTGRES_PASSWORD=ekip_password -p 5432:5432 postgres:15
```

#### 2. Start Qdrant

**Using Docker (recommended for local development):**
```powershell
docker run -d -p 6333:6333 qdrant/qdrant
```

**Or if already installed locally:** Ensure Qdrant is running on port 6333.

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
npm run migrate  # or: npx prisma migrate dev --name init
npm run dev
```

The backend will run at `http://localhost:5000`.

#### 5. Start the AI Service

```powershell
Set-Location .\apps\ai-service
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
ollama serve &  # Ensure Ollama is running in background
python -m uvicorn app:app --host 0.0.0.0 --port 8000
```

The AI service will run at `http://localhost:8000`.

#### 6. Start the Frontend

```powershell
Set-Location .\apps\frontend
npm install
npm run dev
```

The frontend will be available at `http://localhost:5173`.

### Verification

After starting all services:

1. Visit `http://localhost:5173` in your browser
2. Sign up for a new account (or use existing credentials)
3. Upload a supported document (PDF, DOCX, XLSX, or TXT)
4. Wait for processing/indexing to complete
5. Ask a question on the search page
6. Review cited answers and source references