# EKIP — Enterprise Knowledge Intelligence Platform

EKIP is a multi-tenant document knowledge platform. Users upload supported
documents, ask questions in natural language, and receive answers with source
citations. The application includes a React frontend, an Express/Prisma API, a
FastAPI AI service, PostgreSQL, Qdrant, and Ollama.

The AI stack runs locally in Docker. It does **not** search the public web or
send prompts to a hosted LLM API. It answers from the documents ingested into
the EKIP knowledge base.

## Contents

- [How the system fits together](#how-the-system-fits-together)
- [Requirements](#requirements)
- [Run the complete project with Docker](#run-the-complete-project-with-docker)
- [Run only the web application](#run-only-the-web-application-without-ai)
- [Run services locally for development](#run-services-locally-for-development)
- [AI and web access](#ai-and-web-access)
- [Supported documents and current limitations](#supported-documents-and-current-limitations)
- [Useful commands](#useful-commands)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)
- [Documentation](#documentation)

## How the system fits together

```text
Browser
  │
  ├── React + Vite frontend ─────────────── http://localhost:5173
  │       │
  │       └── Express backend API ───────── http://localhost:5000
  │                ├── PostgreSQL ───────── users, organizations, roles
  │                └── FastAPI AI service ─ http://localhost:8000
  │                         ├── Qdrant ──── document chunks and vectors
  │                         └── Ollama ──── local llama3.2:3b model
```

The backend verifies the user's JWT and derives organization, workspace,
department, and role context before forwarding AI requests. The AI service
uses that context to filter document chunks before retrieval.

| Service | Purpose | Host address / port | Started by default? |
| --- | --- | --- | --- |
| Frontend | React application served by Vite | `http://localhost:5173` | Yes |
| Backend | Express API, authentication, authorization, AI proxy | `http://localhost:5000` | Yes |
| PostgreSQL | Application relational database | `localhost:5432` | Yes |
| AI service | Ingestion, retrieval, reranking, answer generation | `http://localhost:8000` | With the `ai` profile |
| Qdrant | Vector storage and similarity search | `localhost:6333` | With the `ai` profile |
| Ollama | Local LLM runtime | `localhost:11434` | With the `ai` profile |

The frontend uses port **5173** both on your computer and inside its container.
The backend allows browser requests only from `http://localhost:5173`.

Uploaded files are parsed from a temporary file; the original file is not
retained. Extracted chunks and vectors are stored in Qdrant, while upload
metadata and processing status are stored in PostgreSQL and shown on the
Upload documents page. Processing progress identifies the current stage:
parsing pages, creating searchable chunks, generating embeddings, and writing
those chunks to Qdrant. Previously indexed uploads are also listed from Qdrant;
their original upload time and processing stages are not available.
Use the delete control beside a document to remove its indexed chunks and
upload-history record.

Search shows the active retrieval, ranking, answer-drafting, and citation
stages. Answers include a brief summary of how many cited passages and
documents support them, with the source excerpts available for review. Private
internal model reasoning is not displayed.

## Requirements

### Docker workflow (recommended)

- Windows 10/11 with Docker Desktop installed and running.
- Docker Desktop using the Linux/WSL 2 engine.
- Git, if cloning the repository.
- An internet connection for the initial Docker image, Python package, and
  model downloads.
- Enough free disk space for Docker images, Python/ML dependencies, and the
  Ollama model. The AI image and model are large; the first build can take a
  while.

You do **not** need to install Node.js, Python, PostgreSQL, Qdrant, or Ollama on
Windows when using Docker Compose.

### Local application development

If you want to run the frontend, backend, or AI service directly on Windows,
install the relevant tools in addition to Docker Desktop:

- Node.js 20 and npm (npm is included with Node.js).
- Python 3.11 for the AI service. Use Python 3.11 for compatibility with the
  pinned document-processing and machine-learning packages.
- Docker Desktop for PostgreSQL, Qdrant, and Ollama, unless you install and
  manage those services separately.
- A browser and an editor such as VS Code.

## Run the complete project with Docker

These steps start the web app, backend, PostgreSQL, AI service, Qdrant, and
Ollama.

### 1. Clone the repository and open the project root

In PowerShell:

```powershell
git clone https://github.com/Jnanamithran/ekip-platform.git
cd ekip-platform
```

If you already have the repository, open PowerShell in its root directory
(the directory containing `docker-compose.yml`).

### 2. Start Docker Desktop

Open Docker Desktop and wait for it to report that the engine is running.
Verify from PowerShell:

```powershell
docker info
docker compose version
```

If `docker info` cannot connect to the Docker engine, start Docker Desktop
before continuing.

### 3. Create the root `.env` file

Compose requires a private `JWT_SECRET`. The following PowerShell command
creates a 32-byte random secret if the root `.env` does not already contain
one:

```powershell
$hasSecret = $false
if (Test-Path .env) {
  $hasSecret = Select-String -Path .env -Pattern '^JWT_SECRET=' -Quiet
}
if (-not $hasSecret) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  Add-Content -Path .env -Value "JWT_SECRET=$([Convert]::ToBase64String($bytes))" -Encoding ASCII
  $rng.Dispose()
}
```

Keep `.env` private; it is ignored by Git. The frontend is available at
`http://localhost:5173`.

### 4. Build and start every service

From the project root:

```powershell
docker compose --profile ai up --build -d
```

The first build downloads and builds the Node and Python dependencies and
Docker images. Leave it time to finish; the AI dependencies are substantially
larger than the web application.

Check container state:

```powershell
docker compose ps
```

Wait until PostgreSQL is healthy and the backend reports healthy. The AI
service, Qdrant, and Ollama should report `Up`.

### 5. Download the local language model

Download the model into the persistent Ollama volume once:

```powershell
docker compose exec ollama ollama pull llama3.2:3b
docker compose exec ollama ollama list
```

Model weights take several gigabytes to download. Subsequent starts reuse the
named volume and do not require downloading the model again.

### 6. Open the application and check service health

- Sign up: <http://localhost:5173/signup>
- Sign in: <http://localhost:5173/login>
- Backend health: <http://localhost:5000/health>
- AI service health: <http://localhost:8000/health>
- Qdrant dashboard: <http://localhost:6333/dashboard>

Create an organization and its first Admin account on the signup page. Then
sign in and upload documents before asking document-related questions.

### What runs, and what persists

The `ai` profile starts the AI service, Qdrant, and Ollama in addition to the
default frontend, backend, and PostgreSQL services. PostgreSQL migrations are
applied by the backend container when it starts.

Compose stores PostgreSQL data, Qdrant data, and Ollama models in named Docker
volumes. Stopping the stack does not delete them. Avoid `docker compose down
-v` unless you intentionally want to erase those databases, indexed documents,
and downloaded model weights.

## Run only the web application without AI

For signup, login, and non-AI API development, start the default services:

```powershell
docker compose up --build -d
```

This starts the frontend, backend, and PostgreSQL. The search and document
ingestion features need the AI profile, so those functions will not be
available in this mode.

To enable all features later:

```powershell
docker compose --profile ai up --build -d
```

Then pull the model if you have not already done so:

```powershell
docker compose exec ollama ollama pull llama3.2:3b
```

## Run services locally for development

This option runs the application code on Windows while Docker provides
PostgreSQL, Qdrant, and Ollama. Do not run Docker's backend or frontend at the
same time as their local counterparts: they use the same host ports.

### 1. Start database and AI infrastructure in Docker

From the repository root:

```powershell
docker compose --profile ai up -d postgres qdrant ollama
docker compose exec ollama ollama pull llama3.2:3b
```

The model pull is needed once. If the Ollama model is already present, check
with `docker compose exec ollama ollama list` instead.

### 2. Configure and start the backend

Create `apps/backend/.env` with local connection settings:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ekip?schema=public
JWT_SECRET=replace-with-a-private-random-secret
PORT=5000
AI_SERVICE_URL=http://localhost:8000
QDRANT_URL=http://localhost:6333
```

Use a private random value for `JWT_SECRET`. The local backend loads this file
when started from `apps/backend`.

In a PowerShell window:

```powershell
cd D:\Program\ekip-platform\apps\backend
npm ci
npx prisma generate --schema src/prisma/schema.prisma
npx prisma migrate deploy --schema src/prisma/schema.prisma
npm run dev
```

Keep the backend terminal open. Check <http://localhost:5000/health>.

### 3. Install and start the AI service

Open another PowerShell window:

```powershell
cd D:\Program\ekip-platform\apps\ai-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
$env:QDRANT_URL = "http://localhost:6333"
$env:OLLAMA_URL = "http://localhost:11434"
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Keep that terminal open. Check <http://localhost:8000/health>. The first
AI-service run may download embedding and reranking model weights. If PowerShell
blocks virtual-environment activation, allow local scripts for your user or
activate the environment using your organization's approved method.

### 4. Install and start the frontend

Open a third PowerShell window:

```powershell
cd D:\Program\ekip-platform\apps\frontend
npm ci
npm run dev
```

Open the URL Vite prints, usually <http://localhost:5173>. Set
`VITE_API_URL=http://127.0.0.1:5000` in `apps/frontend/.env` so the browser
reaches the backend consistently on Windows. If that file is missing, copy
`.env.example` to `.env` in `apps/frontend`.

### Local versus Docker URLs

Inside the Compose network, services reach one another by service name:

- Backend to PostgreSQL: `postgres:5432`
- Backend to AI service: `ai-service:8000`
- AI service to Qdrant: `qdrant:6333`
- AI service to Ollama: `ollama:11434`

Processes running directly on Windows use the published host ports. For the
frontend's browser API URL, use `http://127.0.0.1:5000`; this avoids Windows
resolving `localhost` to an address that does not reach the published Docker
port.

## AI and web access

**The AI does not browse or search the public internet.** It retrieves chunks
from documents that have been uploaded and indexed in Qdrant, then uses the
local Ollama `llama3.2:3b` model to draft a response with citations. The
embedding and reranking models also run in the AI service.

An internet connection is still useful or required for initial setup to
download Docker images, npm/Python packages, Hugging Face model weights, and
the Ollama model. Those downloads are separate from question answering; the
application does not use an internet-search API or a hosted LLM API for its
normal AI query flow.

## Supported documents and current limitations

The AI ingestion code supports:

| File type | Extraction |
| --- | --- |
| PDF | Text-based PDFs; scanned/image-only PDFs need OCR, which is not included |
| DOCX | Word paragraphs and tables |
| XLSX | Spreadsheet content |
| TXT | Plain text |

PPTX and CSV are not currently supported. Search answers only from indexed,
authorized content.

The Admin API supports user, workspace, and department operations. The
frontend's administration screens currently focus on displaying available
data; not every management operation has a UI.

## Useful commands

Run these commands from the repository root:

```powershell
# Start the full stack, including AI
docker compose --profile ai up --build -d

# Show container state
docker compose ps

# Follow all service logs
docker compose logs -f

# Follow a specific service
docker compose logs -f backend
docker compose logs -f ai-service
docker compose logs -f frontend

# Stop containers; named volumes and their data are retained
docker compose down
```

Build the frontend or run its linter from the root:

```powershell
npm --prefix apps/frontend run build
npm --prefix apps/frontend run lint
```

## Troubleshooting

### Docker cannot start the backend: port 5000 is already in use

A locally running Node backend or another process is already bound to the API
port. Stop the local backend with `Ctrl+C` in its terminal, then retry:

```powershell
docker compose --profile ai up -d
```

To identify the process holding the port:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5000 |
  Select-Object LocalAddress, LocalPort, OwningProcess
Get-Process -Id <OwningProcess>
```

Stop only the process you have identified and intend to stop.

### Prisma says `DATABASE_URL` is missing during local development

Create `apps/backend/.env` as shown in [Run services locally for
development](#run-services-locally-for-development). Compose supplies its own
database URL to the backend container; that environment is not automatically
available to a Prisma command run directly on Windows.

### Backend or frontend is not running

Check container status and logs:

```powershell
docker compose ps -a
docker compose logs --tail 100 backend frontend postgres
```

The frontend waits for a healthy backend. The backend waits for healthy
PostgreSQL and applies migrations at startup.

### Search or upload reports that the AI service is unavailable

Start the AI profile and confirm all its services are running:

```powershell
docker compose --profile ai up -d
docker compose ps
docker compose logs --tail 100 ai-service ollama qdrant
```

Confirm the local model is present:

```powershell
docker compose exec ollama ollama list
```

If needed, download it with `docker compose exec ollama ollama pull
llama3.2:3b`.

### Frontend is unavailable on port 5173

Docker Compose publishes the Vite frontend on port 5173. Confirm the frontend
container is running with `docker compose ps` and that host port 5173 is not
already in use. The backend accepts browser requests only from
`http://localhost:5173`.

### Reset all data

`docker compose down` stops and removes containers but retains named volumes.
To permanently remove the PostgreSQL database, Qdrant index, and Ollama model
files as well, `docker compose down -v` deletes those volumes. This cannot be
undone.

## Project layout

```text
ekip-platform/
├── apps/
│   ├── frontend/       # React, Vite, Tailwind UI
│   ├── backend/        # Express API, JWT auth, Prisma schema/migrations
│   └── ai-service/     # FastAPI, ingestion, retrieval, generation, citations
├── docs/               # Project, architecture, API, AI, and deployment guides
├── docker-compose.yml  # Local multi-service stack
└── README.md
```

## Documentation

- [Project Handbook](docs/01_Project_Handbook.md)
- [System Architecture](docs/05_System_Architecture.md)
- [Backend Handbook](docs/06_Backend_Handbook.md)
- [Frontend Handbook](docs/07_Frontend_Handbook.md)
- [AI Handbook](docs/08_AI_Handbook.md)
- [Database and Testing Handbook](docs/09_Database_and_Testing_Handbook.md)
- [Deployment Handbook](docs/10_Deployment_Handbook.md)
- [Project Roadmap](docs/11_Project_Roadmap.md)
