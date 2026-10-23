# Running EKIP Fully Locally (No Docker)

This guide runs every part of EKIP on your Windows machine without Docker:
frontend, backend, text AI service, optional visual AI service, PostgreSQL, Qdrant, and Ollama.

## 0. Quick start (offline / already installed)

Use this if dependencies are already installed and you have no network. Open **one terminal per service** and run only these commands.

### Terminal 1 — PostgreSQL (if not already running as a service)
```powershell
net start postgresql-x64-18
```

### Terminal 2 — Qdrant
```powershell
cd "$env:USERPROFILE\Desktop"
.\qdrant.exe
```

### Terminal 3 — Ollama
```powershell
ollama serve
```
*(Model `llama3.2:3b` must already be pulled; no network available.)*

### Terminal 4 — Backend
```powershell
cd d:\Program\ekip-platform\apps\backend
npm run dev
```

### Terminal 5 — Text AI service
```powershell
cd d:\Program\ekip-platform\apps\ai-service
.\.venv\Scripts\activate
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### Terminal 6 — Frontend
```powershell
cd d:\Program\ekip-platform\apps\frontend
npm run dev
```

### Terminal 7 — Optional visual AI service (GPU required)
```powershell
cd d:\Program\ekip-platform\apps\ai-service-visual
.\.venv\Scripts\activate
python -m uvicorn main:app --host 0.0.0.0 --port 8001
```

Then open `http://localhost:5173`.

---

## 1. Prerequisites

Install these once:

- **Node.js 18+** and npm
- **Python 3.11+** and pip
- **PostgreSQL 15/16** (running locally on `:5432`)
- **Qdrant** binary (runs on `:6333`)
- **Ollama** (runs on `:11434`) with model `llama3.2:3b`
- Optional for visual service: NVIDIA GPU + CUDA + torch

## 2. Environment files

From the repository root:

```powershell
cd d:\Program\ekip-platform
```

### Root `.env`

```powershell
@"
JWT_SECRET=change-this-to-a-long-random-string-minimum-32-chars
AI_SERVICE_API_KEY=generate-a-random-shared-service-key
"@ | Set-Content -Path .env -Encoding ASCII
```

### Backend `apps/backend/.env`

```powershell
Copy-Item apps\backend\.env.example apps\backend\.env
```

Edit `apps/backend/.env` and set at least:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ekip?schema=public
JWT_SECRET=change-this-to-a-long-random-string-minimum-32-chars
AI_SERVICE_URL=http://localhost:8000
AI_SERVICE_API_KEY=generate-a-random-shared-service-key
QDRANT_URL=http://localhost:6333
FRONTEND_ORIGINS=http://localhost:5173
PORT=5000
```

Use the same `AI_SERVICE_API_KEY` value in the AI service env.

### Text AI service `apps/ai-service/.env`

```powershell
Copy-Item apps\ai-service\.env.example apps\ai-service\.env
```

Edit it:

```dotenv
AI_SERVICE_API_KEY=generate-a-random-shared-service-key
QDRANT_URL=http://localhost:6333
OLLAMA_URL=http://localhost:11434
BACKEND_URL=http://localhost:5000
```

### Frontend `apps/frontend/.env`

```powershell
Copy-Item apps\frontend\.env.example apps\frontend\.env
```

```dotenv
VITE_API_URL=http://localhost:5000
```

### Optional visual AI service `apps/ai-service-visual/.env`

If you run the visual service, create its env file with at least:

```dotenv
AI_SERVICE_API_KEY=generate-a-random-shared-service-key
QDRANT_URL=http://localhost:6333
VISUAL_SERVICE_URL=http://localhost:8001
```

## 3. PostgreSQL

Create the database (example uses default `postgres` user):

```powershell
psql -U postgres -c "CREATE DATABASE ekip;"
```

If you use a different user/password, update `DATABASE_URL` in `apps/backend/.env`.

## 4. Qdrant

Run Qdrant locally. If you have the binary:

```powershell
cd "$env:USERPROFILE\Desktop"
.\qdrant.exe
```

Qdrant listens on `http://localhost:6333`.  
Data is stored in a `storage` folder next to `qdrant.exe`.

To reset Qdrant later:

```powershell
Get-Process qdrant | Stop-Process -Force
Remove-Item -Recurse -Force "$env:USERPROFILE\Desktop\storage"
Start-Process -FilePath "$env:USERPROFILE\Desktop\qdrant.exe" -WorkingDirectory "$env:USERPROFILE\Desktop"
```

## 5. Ollama

Start Ollama and pull the model:

```powershell
ollama serve
ollama pull llama3.2:3b
```

Keep `ollama serve` running in its own terminal.
## 6. Backend (Express + Prisma)

```powershell
cd d:\Program\ekip-platform\apps\backend
npm ci
npx prisma migrate deploy --schema src/prisma/schema.prisma
node src/prisma/seed.js
npm run dev
```

- Backend runs at `http://localhost:5000`.
- `seed.js` creates the demo admin account using `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env`.

## 7. Text AI service (FastAPI)

```powershell
cd d:\Program\ekip-platform\apps\ai-service
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

The service auto-loads `.env` now, so manual loading is no longer required.

Start the service:

```powershell
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Text AI service runs at `http://localhost:8000`.

## 8. Frontend (React + Vite)

```powershell
cd d:\Program\ekip-platform\apps\frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.

## 9. Optional visual AI service (ColPali + Qwen2-VL)

Requires a CUDA-capable GPU. Install torch first:

```powershell
cd d:\Program\ekip-platform\apps\ai-service-visual
python -m venv .venv
.\.venv\Scripts\activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

Load env and start (service auto-loads `.env` now):

```powershell
python -m uvicorn main:app --host 0.0.0.0 --port 8001
```

Visual service runs at `http://localhost:8001`.

## 10. Recommended startup order

1. PostgreSQL
2. Qdrant
3. Ollama
4. Backend
5. Text AI service
6. Frontend
7. Optional visual AI service

## 11. Verification

After all services are running:

1. Open `http://localhost:5173`
2. Sign up or log in (demo admin: `admin@test.com` / `Pla@thottam1` if seeded)
3. Upload a PDF, DOCX, XLSX, or TXT document
4. Wait for indexing to finish
5. Ask a question on the search page
6. Confirm cited answers are returned

Health checks:

```powershell
curl.exe -s http://localhost:5000/health
curl.exe -s http://localhost:8000/health
curl.exe -s http://localhost:6333/collections
```

## 12. Useful local reset commands

### Reset Qdrant only

```powershell
Get-Process qdrant | Stop-Process -Force
Remove-Item -Recurse -Force "$env:USERPROFILE\Desktop\storage"
Start-Process -FilePath "$env:USERPROFILE\Desktop\qdrant.exe" -WorkingDirectory "$env:USERPROFILE\Desktop"
```

### Reset backend database (destructive)

```powershell
cd d:\Program\ekip-platform\apps\backend
npx prisma migrate reset --schema src/prisma/schema.prisma
node src/prisma/seed.js
```

### Reset uploaded files

```powershell
Remove-Item -Recurse -Force d:\Program\ekip-platform\apps\backend\uploads\*
```

## 14. Delete and restart Qdrant (local)

### Stop Qdrant

```powershell
Get-Process qdrant | Stop-Process -Force
```

### Delete Qdrant data

Qdrant stores data in the `storage` folder next to `qdrant.exe` (in this setup: Desktop).

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\Desktop\storage"
```

If you used a custom storage path, delete that folder instead.

### Start Qdrant again

```powershell
Start-Process -FilePath "$env:USERPROFILE\Desktop\qdrant.exe" -WorkingDirectory "$env:USERPROFILE\Desktop"
```

### Verify it is empty

```powershell
curl.exe -s http://localhost:6333/collections
```

Expected:

```json
{"result":{"collections":[]},"status":"ok","time":...}
```

### Recreate collections (optional)

Collections are recreated automatically on first document upload. To create them immediately:

```powershell
curl.exe -X PUT http://localhost:6333/collections/ekip_documents -H "Content-Type: application/json" -d '{"vectors":{"size":384,"distance":"Cosine"}}'
curl.exe -X PUT http://localhost:6333/collections/ekip_visual_documents -H "Content-Type: application/json" -d '{"vectors":{"size":128,"distance":"Cosine"}}'
```

Adjust vector sizes to match your embedders.

---

## 15. Delete and restart PostgreSQL (local)

### Option A: Drop and recreate only the `ekip` database (recommended)

This keeps PostgreSQL running and only wipes the EKIP database.

```powershell
# Drop the database (terminates existing connections)
dropdb -U postgres --if-exists ekip

# Recreate it
createdb -U postgres ekip
```

Then reset schema and seed data:

```powershell
cd d:\Program\ekip-platform\apps\backend
npx prisma migrate deploy --schema src/prisma/schema.prisma
node src/prisma/seed.js
```

### Option B: Full PostgreSQL data reset (destructive)

Use this only if you want to wipe all PostgreSQL databases and start completely fresh.

1. Stop the PostgreSQL service (service name may vary by version):

```powershell
net stop postgresql-x64-16
```

If that name does not exist, find the service name:

```powershell
Get-Service | Where-Object {$_.Name -like "*postgres*"}
```

2. Delete the PostgreSQL data directory (example path; adjust to your install/version):

```powershell
Remove-Item -Recurse -Force "C:\Program Files\PostgreSQL\16\data"
```

3. Recreate an empty data directory and reinitialize PostgreSQL:

```powershell
mkdir "C:\Program Files\PostgreSQL\16\data"
& "C:\Program Files\PostgreSQL\16\bin\initdb.exe" -D "C:\Program Files\PostgreSQL\16\data" -U postgres
```

4. Start PostgreSQL again:

```powershell
net start postgresql-x64-16
```

5. Create the EKIP database and apply schema:

```powershell
createdb -U postgres ekip
cd d:\Program\ekip-platform\apps\backend
npx prisma migrate deploy --schema src/prisma/schema.prisma
node src/prisma/seed.js
```

### Verify PostgreSQL

```powershell
psql -U postgres -d ekip -c "\dt"
```

You should see the EKIP tables (User, Organization, Document, etc.).

### Restart dependent services

After resetting Qdrant or PostgreSQL, restart the services that use them:

```powershell
# Backend
cd d:\Program\ekip-platform\apps\backend
npm run dev

# Text AI service
cd d:\Program\ekip-platform\apps\ai-service
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

---

## 16. Troubleshooting

- **Backend cannot reach AI service**: check `AI_SERVICE_URL` and `AI_SERVICE_API_KEY` match in both `.env` files.
- **AI service returns 503 on internal calls**: `AI_SERVICE_API_KEY` is missing or shorter than 32 characters in the AI service env.
- **Qdrant connection refused**: ensure `qdrant.exe` is running on port `6333`.
- **Ollama errors**: ensure `ollama serve` is running and `llama3.2:3b` is pulled.
- **Prisma migration errors**: verify PostgreSQL is running and `DATABASE_URL` is correct.
- **Frontend cannot reach backend**: verify `VITE_API_URL` and backend `FRONTEND_ORIGINS`.

