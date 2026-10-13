# EKIP - Enterprise Knowledge Intelligence Platform

EKIP is a multi-tenant knowledge platform for uploading documents and finding information with role-aware search. It includes a React frontend, an Express/Prisma API, PostgreSQL, and an optional AI stack built with FastAPI, Qdrant, and Ollama.

## Choose how to run EKIP

For the easiest setup on Windows, use Docker Compose. It builds and runs the frontend, backend, and PostgreSQL together, without installing Node.js or PostgreSQL on Windows.

| Goal | Recommended setup |
| --- | --- |
| Try login, signup, and the web interface | Docker Compose default services |
| Change frontend code with Vite | Run frontend locally; run backend and PostgreSQL with Docker |
| Change backend code with Nodemon | Run frontend and backend locally; run PostgreSQL with Docker |
| Try AI/document features | Start the Docker Compose `ai` profile as well |

The AI service is not required for signup or login.

## Requirements

### Docker setup (recommended)

- Windows 10/11 with Docker Desktop installed and running.
- Docker Desktop configured to use the Linux/WSL 2 engine.
- Git, if cloning the repository.
- An internet connection for the first image and dependency downloads.

Node.js, Python, PostgreSQL, Qdrant, and Ollama do not need to be installed on Windows for the Docker workflow. Docker images and AI dependencies use significant disk space. If needed, choose Docker Desktop's disk location under **Settings > Resources > Advanced > Disk image location** before building images.

### Local development setup

- Node.js `20.19+` or `22.12+` and npm (required by the frontend tooling).
- PostgreSQL 16, or Docker Desktop to run only the PostgreSQL service.
- Python 3.11 for local AI service development.
- Git.

## Run the web app with Docker on Windows

Open PowerShell in the repository root:

```powershell
cd D:\Program\ekip-platform
```

### 1. Start Docker Desktop and verify the engine

Open Docker Desktop and wait until it says it is running. Check that its Linux engine is available:

```powershell
docker info
```

The output must include server details. If it says it cannot connect to the Docker API, start or restart Docker Desktop before continuing.

### 2. Create the project JWT secret

Compose reads its settings from a `.env` file in the repository root. Generate a secret if one is not already present:

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

Keep this `.env` file private; it is local configuration and should not be committed.

### 3. Build and start the login/signup services

```powershell
docker compose up --build
```

On first startup Docker downloads the base images and installs dependencies. This can take several minutes. Leave this terminal open while using EKIP. The Compose setup starts:

- PostgreSQL on port `5432`
- Backend API on port `5000`
- Frontend on port `5175` on your computer (port `5173` inside its container)

The backend waits for PostgreSQL, applies Prisma migrations, and then starts the API. Open:

- Signup: <http://localhost:5175/signup>
- Login: <http://localhost:5175/login>
- Backend health check: <http://localhost:5000/health>

Create an organization and admin account from the signup page, then sign in. Do not run `npm run dev` for the backend at the same time: the Docker backend already uses port `5000`.

### Docker Compose commands

Run these from the repository root:

```powershell
# Show service status
docker compose ps

# Follow application logs
docker compose logs -f backend frontend postgres

# Stop containers (keeps database and other named-volume data)
docker compose down

# Start again without rebuilding
docker compose up
```

Do not use `docker compose down -v` unless you deliberately want to delete the project's persistent database/vector/model volumes.

### Change the frontend port

The default host port is `5175` to avoid common conflicts on `5173` and `5174`. If `5175` is also in use, add a free host port to the root `.env`, for example:

```text
FRONTEND_PORT=5176
```

Stop and restart Compose so the new port and matching CORS origin are applied:

```powershell
docker compose down
docker compose up --build
```

Open `http://localhost:5176` in this example. The API remains at `http://localhost:5000`.

## Start the optional AI services

The AI services are disabled in the default Compose run so you can start the web app without downloading the large AI dependencies and Ollama image. To run document/AI components, start the `ai` profile:

```powershell
docker compose --profile ai up --build
```

This additionally starts the FastAPI AI service, Qdrant, and Ollama. The first AI build can take a long time and needs more disk space because it installs PyTorch and sentence-transformers dependencies.

After the Ollama service is running, download the model once:

```powershell
docker compose exec ollama ollama pull llama3.2:3b
```

The model is stored in a Docker named volume and is kept when you run `docker compose down`. AI-backed application flows may still be in development.

## Run services locally

For local code development, you can run PostgreSQL in Docker and run Node services directly on Windows. Start Docker Desktop first.

### 1. Start PostgreSQL only

From the repository root:

```powershell
docker compose up -d postgres
```

PostgreSQL is exposed to Windows on port `5432`. Compose initializes the `ekip` database with username `postgres` and password `postgres`.

### 2. Configure and start the backend

Open a PowerShell window:

```powershell
cd D:\Program\ekip-platform\apps\backend
npm install
npx prisma generate --schema src/prisma/schema.prisma
```

Create `apps/backend/.env` with these values (use the same JWT secret as the root `.env`, or generate another private random secret):

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ekip?schema=public
JWT_SECRET=replace-with-a-private-random-secret
FRONTEND_ORIGINS=http://localhost:5173,http://localhost:5175
PORT=5000
```

Apply the database migrations, then start the API:

```powershell
npx prisma migrate deploy --schema src/prisma/schema.prisma
npm run dev
```

Keep this terminal open. The API should respond at <http://localhost:5000/health>.

### 3. Install and start the frontend

In a second PowerShell window:

```powershell
cd D:\Program\ekip-platform\apps\frontend
npm install
npm run dev
```

Open the URL Vite prints, normally <http://localhost:5173>. The checked-in `apps/frontend/.env` configures the API URL as `http://localhost:5000`.

Run **either** the Docker backend or the local backend, not both: both use port `5000`. For local frontend development against the Docker backend, start Compose's `postgres` and `backend` services, then run the frontend with Vite locally.

## Run the AI service locally (optional)

Use Python 3.11. In PowerShell:

```powershell
cd D:\Program\ekip-platform\apps\ai-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

The AI service also expects Qdrant and Ollama at the URLs configured by `QDRANT_URL` and `OLLAMA_URL`. The simplest way to provide them is to run the Compose AI profile. From the repository root:

```powershell
docker compose --profile ai up -d qdrant ollama
docker compose exec ollama ollama pull llama3.2:3b
```

Then, in the activated Python environment:

```powershell
$env:QDRANT_URL = "http://localhost:6333"
$env:OLLAMA_URL = "http://localhost:11434"
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The ingestion-only dependencies are listed separately in `apps/ai-service/ingestion/requirements-ingestion.txt`; install them only if working on those parsers and they are not already included in the main environment.

## Ports

| Component | Host URL / port | Notes |
| --- | --- | --- |
| Frontend (Docker) | <http://localhost:5175> | Change with `FRONTEND_PORT` in root `.env` |
| Frontend (local Vite) | <http://localhost:5173> | Vite's default configured port |
| Backend API | <http://localhost:5000> | Health check: `/health` |
| PostgreSQL | `localhost:5432` | Database `ekip` |
| AI service | <http://localhost:8000> | Optional |
| Qdrant | <http://localhost:6333> | Optional |
| Ollama | `localhost:11434` | Optional |

## Troubleshooting

### Docker cannot connect to the Docker API

Start Docker Desktop, wait for the Linux/WSL 2 engine to finish starting, then run `docker info` again. Do not run Compose until `docker info` shows server details.

### `EADDRINUSE` on port 5000

Port `5000` is already occupied, commonly because the Docker backend is running. Do not start another backend with `npm run dev` at the same time. To use the local backend instead, stop the Compose backend first:

```powershell
docker compose stop backend
```

### Port 5175 is already in use

Set `FRONTEND_PORT` to another available host port in the repository-root `.env`, then restart Compose. The backend's Compose CORS configuration follows that port.

### CORS error in the browser

The backend allows local Vite (`http://localhost:5173`) and the configured Docker frontend port. If you use a different local frontend origin, add it to `FRONTEND_ORIGINS` in the backend environment and restart the backend.

### Check service health and logs

From the repository root:

```powershell
docker compose ps
Invoke-RestMethod http://localhost:5000/health
docker compose logs --tail 100 backend frontend postgres
```

## Project layout

```text
apps/
  ai-service/   FastAPI, ingestion, embeddings, retrieval, and AI pipeline
  backend/      Express API, authentication, Prisma schema, and migrations
  frontend/     React/Vite user interface
docs/           Project, architecture, API, AI, and deployment handbooks
docker-compose.yml
```

## Documentation

- [Project Handbook](docs/01_Project_Handbook.md)
- [System Architecture](docs/05_System_Architecture.md)
- [Backend Handbook](docs/06_Backend_Handbook.md)
- [AI Handbook](docs/08_AI_Handbook.md)
- [Deployment Handbook](docs/10_Deployment_Handbook.md)
- [Project Roadmap](docs/11_Project_Roadmap.md)

## License

This project is developed as a Final Year Engineering Project under KTU (APJ Abdul Kalam Technological University). All rights reserved.
