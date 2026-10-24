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
VISUAL_SERVICE_URL=http://localhost:8001
VISUAL_ASK_TIMEOUT=1800
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
VISUAL_STORAGE=d:/Program/ekip-platform/apps/backend/uploads/visual
COLPALI_MODEL=vidore/colpali-v1.2
QWEN_MODEL=Qwen/Qwen2-VL-2B-Instruct
HF_HOME=D:/HF-Cache
```

> **Storage sharing:** the backend serves page images from
> `UPLOAD_STORAGE_DIR/visual/...`. Keep `VISUAL_STORAGE` pointing at the
> same directory (the default `uploads/visual` only matches in Docker).

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

The visual models load lazily, so starting Uvicorn alone does not load ColPali
or Qwen2-VL. Only scanned/image-only PDFs are sent to visual ingestion, and a
question calls visual Q&A only when the caller's RBAC scope includes indexed
visual pages. ColPali loads for visual ingestion/retrieval; Qwen2-VL loads only
when visual pages were retrieved. On a 6-GB GPU, the service releases ColPali
before loading Qwen2-VL and releases Qwen2-VL after answering. Ollama also uses
GPU memory; stop its loaded model while testing the visual pipeline on a 6-GB
GPU to avoid competing allocations.

Set `HF_HOME` in `apps/ai-service-visual/.env` to a drive with sufficient
free space. Hugging Face reads this setting at process startup; setting it
temporarily in PowerShell does not persist across new terminals. Once model
weights are cached, later requests load them from disk rather than downloading
them again. This service unloads models after inference to fit the available
GPU memory, so loading weights into GPU memory may still take time per request.

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

## 12. Local reset commands

Database, uploaded-file, and Qdrant resets are separate destructive actions.
Use only the reset procedure for the data you intend to remove. The PostgreSQL
reset procedure below does not clear uploaded files or Qdrant indexes.

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

## 15. Reset the local PostgreSQL database

The repository-root `reset_db.bat` script prompts before dropping and
recreating only the `ekip` database, then applies Prisma migrations. It does
not delete the PostgreSQL data directory, other databases, uploaded files, or
Qdrant indexes. This permanently removes all records in `ekip`; back up any
data you need first.

From PowerShell at the repository root:

```powershell
.\reset_db.bat
```

The script expects `psql` to be on `PATH` and uses `PGHOST`, `PGPORT`, and
`PGUSER` when set; otherwise it connects to `localhost:5432` as `postgres`.
If PostgreSQL requires a password, enter it when prompted. To create demo
seed data after the migrations:

```powershell
Set-Location .\apps\backend
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

---

## 17. Verified local run (no Docker)

The following commands were verified on this machine:

### Services
```powershell
# Text AI service
cd d:\Program\ekip-platform\apps\ai-service
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000

# Visual AI service
cd d:\Program\ekip-platform\apps\ai-service-visual
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8001
```

### Health checks
```powershell
curl.exe -s http://localhost:8000/health
curl.exe -s http://localhost:8001/health
```

### Tests
```powershell
cd d:\Program\ekip-platform\apps\ai-service
.\.venv\Scripts\python.exe -m pytest -q

cd d:\Program\ekip-platform\apps\ai-service-visual
.\.venv\Scripts\python.exe -m pytest -q
```
Visual service tests: **18 passed**. Text AI service tests: **39 passed**.

### Visual ingest (ColPali)
```powershell
cd d:\Program\ekip-platform
.\apps\ai-service-visual\.venv\Scripts\python.exe -c "import httpx,json,uuid; rbac={'org_id':'org-1','workspace_id':'workspace-1','department_id':'department-1','allowed_role_ids':['role-1'],'uploaded_by':'user-1'}; doc_id=str(uuid.uuid4()); files={'file':('test.pdf',open('apps/ai-service/tests/fixtures/test.pdf','rb'),'application/pdf')}; data={'rbac':json.dumps(rbac),'document_id':doc_id}; h={'x-ekip-service-key':'<AI_SERVICE_API_KEY>'}; r=httpx.Client(timeout=300).post('http://localhost:8001/visual/ingest',data=data,files=files,headers=h); print(r.status_code); print(r.text)"
```
Expected: HTTP 200 with `pages_upserted` (3 for the bundled test PDF) and `pipeline: visual`.
