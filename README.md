# EKIP

EKIP (Enterprise Knowledge Intelligence Platform) is a local-first workspace
for organizing company documents and answering questions from information a
signed-in user is authorized to access. It combines a React web app, an
Express/Prisma API, PostgreSQL, a Python AI service, Qdrant, and Ollama.

EKIP is a development prototype, not a production-hardened service. Do not use
it with sensitive or business-critical data without first reviewing its
security, operational, and backup requirements.

## What it does

- Creates an organization, workspace, default department, and initial Owner
  account during signup.
- Manages users and custom organization-wide or department-scoped roles.
- Ingests PDF, DOCX, XLSX, and TXT documents, then indexes their content for
  search.
- Answers questions using locally hosted language models and returns source
  citations. PDF page previews are available when the original PDF is retained.
- Imports supported files from Google Drive when OAuth is configured. Imported
  documents use EKIP permissions; Google Drive sharing permissions are not
  preserved.
- Optionally processes scanned pages with a separate visual AI service.

Access is enforced by the backend and document retrieval services. Department
access is limited to the user's workspace, and a document's allowed roles must
match its target department. The protected Owner role receives special
handling.

## Architecture

```text
Browser
  └── React + Vite frontend :5173
        └── Express + Prisma backend :5000
              ├── PostgreSQL :5432
              └── FastAPI text AI service :8000
                    ├── Qdrant :6333
                    └── Ollama :11434

Optional visual AI service :8001
  └── ColPali embeddings + Qwen2-VL
```

| Component | Port | Responsibility |
| --- | ---: | --- |
| Frontend | 5173 | Browser application |
| Backend | 5000 | Authentication, permissions, workspace and document APIs |
| PostgreSQL | 5432 | Application and document metadata |
| Text AI service | 8000 | Document ingestion, retrieval, generation, and citations |
| Qdrant | 6333 | Vector search |
| Ollama | 11434 | Local language-model runtime |
| Visual AI service (optional) | 8001 | Scanned-page indexing and visual question answering |

## Run with Docker Compose

The Compose setup is intended for local development on Windows with Docker
Desktop configured to use its Linux/WSL 2 engine. Allow several gigabytes of
disk space for images, Python dependencies, and model files. Node.js and Python
do not need to be installed on the host for this setup.

From the repository root, create a private `.env` file containing separate
random values for `JWT_SECRET` and `AI_SERVICE_API_KEY` if one does not already
exist:

```powershell
if (-not (Test-Path .env)) {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $jwtSecret = [Convert]::ToBase64String($bytes)
    $rng.GetBytes($bytes)
    $aiServiceKey = [Convert]::ToBase64String($bytes)
    $rng.Dispose()
    Set-Content -Path .env -Value "JWT_SECRET=$jwtSecret`nAI_SERVICE_API_KEY=$aiServiceKey" -Encoding ASCII
}
```

Keep these values private and do not commit `.env`. Start the text AI stack
without the optional GPU-dependent visual service:

```powershell
docker compose --profile ai up --build -d --scale ai-service-visual=0
docker compose ps
docker compose exec ollama ollama pull llama3.2:3b
```

The first build and model download can take some time. When the services are
ready, open <http://localhost:5173>. To stop the stack while preserving its
data, run:

```powershell
docker compose down
```

The optional visual service is included in the `ai` profile and requires a
compatible NVIDIA GPU and Docker GPU support. To start it, omit
`--scale ai-service-visual=0` from the `up` command. Removing Compose volumes
deletes persisted development data; do not use `docker compose down -v` unless
you intend to remove it.

## Run without Docker

For Windows instructions covering PostgreSQL, Qdrant, Ollama, environment
files, migrations, and starting each application, see
[LOCAL_RUNNING.md](LOCAL_RUNNING.md). The visual service is optional and needs
its model files and compatible GPU hardware for practical inference.

The main application directories are:

| Path | Contents |
| --- | --- |
| `apps/frontend` | React and Vite web application |
| `apps/backend` | Express API, Prisma schema, and migrations |
| `apps/ai-service` | Text ingestion and retrieval-augmented generation |
| `apps/ai-service-visual` | Optional visual document service |
| `docs` | Project, architecture, service, deployment, and roadmap guides |

## Configuration

The Compose setup reads `JWT_SECRET` and `AI_SERVICE_API_KEY` from the root
`.env` file. For direct local development, follow the per-service environment
setup in [LOCAL_RUNNING.md](LOCAL_RUNNING.md). Common settings include:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | Backend | Signs authentication tokens |
| `DATABASE_URL` | Backend | PostgreSQL connection |
| `AI_SERVICE_URL` | Backend | Text AI service address |
| `AI_SERVICE_API_KEY` | Backend and AI services | Authenticates internal service requests |
| `QDRANT_URL` | Backend and AI services | Qdrant address |
| `OLLAMA_URL` | Text AI service | Ollama address |
| `BACKEND_URL` | Text AI service | Backend progress reporting |
| `FRONTEND_ORIGINS` | Backend | Allowed browser origins |
| `VITE_API_URL` | Frontend | Backend address used by the browser |
| `VISUAL_SERVICE_URL` | Text AI service | Optional visual AI service address |

Google Drive integration additionally requires Google OAuth credentials. See
the [Google Drive integration guide](docs/06_Backend_Handbook.md#google-drive-apis).

## Checks

Run frontend lint and build from the repository root:

```powershell
npm --prefix apps/frontend run lint
npm --prefix apps/frontend run build
```

Run backend tests and validate the Prisma schema:

```powershell
Set-Location .\apps\backend
npm ci
npm test
npx prisma validate --schema src/prisma/schema.prisma
```

Run the text AI tests:

```powershell
Set-Location .\apps\ai-service
python -m pytest tests -q
```

The text AI tests include Qdrant integration coverage and require Qdrant to be
available locally. The visual service tests and their optional setup are
documented in [LOCAL_RUNNING.md](LOCAL_RUNNING.md).

## Known limitations

- This is a prototype. Production deployment, monitoring, backup and recovery,
  and independent security review are not complete.
- Scanned-document processing depends on OCR/model support. The visual
  processing stack has significant storage and hardware requirements.
- PPTX and CSV uploads are not supported.
- Google Drive import applies EKIP role-based access and does not preserve
  Drive's existing sharing permissions.
- PDF page previews require the original PDF to remain available.

## Further documentation

- [Local Windows setup](LOCAL_RUNNING.md)
- [Project handbook](docs/01_Project_Handbook.md)
- [System architecture](docs/05_System_Architecture.md)
- [Backend handbook](docs/06_Backend_Handbook.md)
- [AI handbook](docs/08_AI_Handbook.md)
- [Deployment handbook](docs/10_Deployment_Handbook.md)
- [Project roadmap](docs/11_Project_Roadmap.md)
- [Project progress](PROJECT_PROGRESS.md)
