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

Wait for PostgreSQL and the backend to become healthy, then open
<http://localhost:5173/signup>. The full `ai` profile includes the visual AI
service, whose Compose configuration requests an NVIDIA GPU. If your Docker
installation cannot provide one, the profile may fail to start; see the
deployment handbook for troubleshooting and options.

### Stop and inspect

```powershell
docker compose ps
docker compose logs --tail 100
docker compose logs --tail 100 backend
docker compose down
```

`docker compose down` preserves named volumes. **Do not use
`docker compose down -v` unless you intend to delete the database, indexed
content, retained uploads, and downloaded Ollama models.**

## Run application code locally without Docker

This runs the frontend, backend, and AI application processes directly on
Windows. You still need local installations of PostgreSQL, Qdrant, and Ollama;
this guide does not use containers for those dependencies. Install PostgreSQL,
create a database named `ekip`, and start PostgreSQL, Qdrant, and Ollama so they
are reachable on their default ports. Then fetch the model:

```powershell
ollama pull llama3.2:3b
```

Run each application in its own PowerShell window. Do not also start the
corresponding Compose application services, because they use the same host
ports.

### Backend

From the repository root, in PowerShell:

```powershell
Set-Location .\apps\backend
```

Create `.env` in the current directory (`apps/backend/.env` in the repository)
with your PostgreSQL password and a private JWT secret:

```dotenv
DATABASE_URL="postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/ekip?schema=public"
JWT_SECRET=replace-with-a-long-private-random-secret
PORT=5000
AI_SERVICE_URL=http://localhost:8000
QDRANT_URL=http://localhost:6333
UPLOAD_STORAGE_DIR=uploads
FRONTEND_ORIGINS=http://localhost:5173
```

Install dependencies, generate Prisma Client, apply migrations, and run the
development server:

```powershell
npm ci
npx prisma generate --schema src/prisma/schema.prisma
npx prisma migrate deploy --schema src/prisma/schema.prisma
npm run dev
```

### Text AI service

In another PowerShell window:

```powershell
Set-Location .\apps\ai-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
$env:QDRANT_URL = "http://localhost:6333"
$env:OLLAMA_URL = "http://localhost:11434"
$env:BACKEND_URL = "http://localhost:5000"
$env:VISUAL_SERVICE_URL = "http://localhost:8001"
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The text pipeline can run without the visual service. Scanned PDFs requiring
visual indexing need that additional service and compatible hardware.

### Frontend

In a third PowerShell window:

```powershell
Set-Location .\apps\frontend
npm ci
```

Set `VITE_API_URL=http://localhost:5000` in `apps/frontend/.env` if the
existing environment file does not already point to the local backend, then
start Vite:

```powershell
npm run dev
```

Open <http://localhost:5173/signup>.

## Use EKIP

1. Create an organization, workspace, department, and first Admin account on
   the Signup page.
2. Sign in and upload a PDF, DOCX, XLSX, or TXT file.
3. Wait for processing/indexing to finish, then ask a question on Search.
4. Review source citations. PDF page previews are available when an original
   PDF is retained.
5. Admins can review workspace settings and manage users. The backend also
   provides a Google Drive integration; connect and import supported files from
   the Integrations page.

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

## Known limitations

- This is a prototype; production deployment, operational monitoring, backup
  and recovery, and independent security review are not complete.
- Scanned-PDF visual processing requires the optional visual model stack and
  substantial compute resources. Text extraction/OCR behavior depends on the
  document and installed model/runtime support.
- Supported upload formats are PDF, DOCX, XLSX, and TXT. PPTX and CSV are not
  supported.
- Google Drive import uses EKIP role-based permissions; it does not preserve
  Drive sharing permissions.
- PDF preview requires the original file to be retained. Other supported
  formats provide text citations, not PDF previews.

## Project documentation

- [Project progress](PROJECT_PROGRESS.md)
- [Project handbook](docs/01_Project_Handbook.md)
- [System architecture](docs/05_System_Architecture.md)
- [Backend handbook](docs/06_Backend_Handbook.md)
- [AI handbook](docs/08_AI_Handbook.md)
- [Deployment handbook](docs/10_Deployment_Handbook.md)
- [Project roadmap](docs/11_Project_Roadmap.md)
