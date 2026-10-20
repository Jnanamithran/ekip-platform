# Deployment Handbook

This handbook describes local development startup. It is not a production
deployment guide: production hosting, TLS termination, secret rotation,
backups, scaling, and observability require additional design and validation.

## Requirements

### Docker Compose

- Windows 10/11 with Docker Desktop and the Linux/WSL 2 engine, or a compatible
  Docker Engine and Compose v2 installation.
- Internet access and enough free disk space for images, Python packages, and
  downloaded models.
- NVIDIA GPU support configured in Docker for the visual service in the full
  `ai` profile.

### Running application processes directly

- Node.js and npm for the backend and frontend.
- Python 3.11 for the text AI service.
- PostgreSQL, Qdrant, and Ollama installed and running locally.

## Docker Compose startup

From the repository root, create a private `.env` file containing a
`JWT_SECRET`. Example of generating a random value in PowerShell:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes)
$rng.Dispose()
Set-Content -Path .env -Value "JWT_SECRET=$secret" -Encoding ASCII
```

Do not overwrite an existing `.env` containing configuration you want to keep.
Then build and start:

```powershell
docker compose --profile ai up --build -d
docker compose ps
docker compose exec ollama ollama pull llama3.2:3b
```

The backend container applies Prisma migrations at startup. Initial image
builds and model downloads can take a while. Once ready:

- Frontend: <http://localhost:5173>
- Backend health: <http://localhost:5000/health>
- Text AI health: <http://localhost:8000/health>
- Qdrant dashboard: <http://localhost:6333/dashboard>

### GPU limitation and text-only development

The Compose `ai` profile includes the visual service, which reserves an
NVIDIA GPU. If the host does not provide a compatible GPU runtime, that
service can prevent the full profile from starting. For text-only work, either
run the application processes locally with PostgreSQL, Qdrant, and Ollama
installed on Windows or adjust the local Compose profile to omit the visual
service. Scanned-page visual indexing will not be available in a text-only
setup.

Do not concurrently run a Compose service and a local instance of that same
service; both attempt to bind the same host port.

## Running application code without Docker

Start PostgreSQL, Qdrant, and Ollama locally. Create the PostgreSQL `ekip`
database and run `ollama pull llama3.2:3b`. Start the applications in separate
PowerShell windows.

### Backend

Set up `apps/backend/.env` with local values:

```dotenv
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/ekip?schema=public"
JWT_SECRET=use-a-long-private-random-value
PORT=5000
AI_SERVICE_URL=http://localhost:8000
QDRANT_URL=http://localhost:6333
UPLOAD_STORAGE_DIR=uploads
FRONTEND_ORIGINS=http://localhost:5173
```

Then:

```powershell
Set-Location .\apps\backend
npm ci
npx prisma generate --schema src/prisma/schema.prisma
npx prisma migrate deploy --schema src/prisma/schema.prisma
npm run dev
```

### Text AI service

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

### Frontend

In another PowerShell window:

```powershell
Set-Location .\apps\frontend
npm ci
npm run dev
```

Ensure `apps/frontend/.env` sets `VITE_API_URL=http://localhost:5000`. Visit
<http://localhost:5173/signup>.

## Verification and troubleshooting

```powershell
docker compose ps
docker compose logs --tail 100
docker compose logs --tail 100 backend
docker compose logs --tail 100 ai-service
docker compose logs --tail 100 frontend
```

Check that host ports `5173`, `5000`, `5432`, `6333`, `8000`, and `11434` are
available. Confirm PostgreSQL is accepting connections, Qdrant responds at
port 6333, and Ollama has the model installed with `ollama list`.

If backend startup fails, confirm the root Compose `.env` has `JWT_SECRET`,
the database is healthy, and Prisma migrations complete. If the AI service
cannot connect, check that its URLs use `localhost` for local processes and
Compose service names for containers. For a GPU-related error, use a
GPU-enabled Docker setup or run without the visual service.

## Stop and persistence

```powershell
docker compose down
```

This stops containers but preserves named volumes. `docker compose down -v`
deletes persisted database, Qdrant, Ollama, and upload data. Use it only when
you explicitly intend to discard all of that data.

## Configuration and secret handling

Keep root and service `.env` files private and out of version control. Compose
uses the root `JWT_SECRET`; local backend startup uses `apps/backend/.env`.
Optional Google Drive OAuth settings are described in the [backend
handbook](06_Backend_Handbook.md#google-drive-apis). Never copy real secrets
into command output, documentation, or issue reports.
