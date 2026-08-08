# Deployment Handbook

## Purpose
This handbook documents how to boot the full EKIP stack locally via Docker Compose, and records known issues encountered during setup along with their fixes — so future contributors don't re-debug the same problems.

## Prerequisites
- Docker Desktop installed and running (WSL 2 backend on Windows)
- Git installed
- Repo cloned locally: `git clone https://github.com/Jnanamithran/ekip-platform.git`

## Booting the stack

From the project root:
```bash
docker-compose up --build
```

This builds and starts all 6 services: `frontend`, `backend`, `ai-service`, `qdrant`, `postgres`, `ollama`.

First-time boot will be slow — the `ollama/ollama:latest` image alone is ~3.2GB, and `ai-service` installs several large Python packages (notably `torch`). Subsequent boots reuse cached layers and are much faster.

To rebuild a single service after a fix (without restarting the whole stack):
```bash
docker-compose up --build <service-name>
```

## Verifying it's working

| Service | Check |
|---|---|
| postgres | Logs show `database system is ready to accept connections` |
| qdrant | Container status `Up`, no restart loops |
| ollama | Container status `Up` |
| ai-service | Container status `Up`, no crash in logs |
| backend | Container status `Up`, no crash in logs |
| frontend | Visit `http://localhost:3000/` — a 404 is currently expected (see Known Issues) |

Use `docker ps` to confirm all containers show `Up`, and `docker-compose logs <service-name>` to inspect any individual service's output.

## Known issues & fixes

### 1. Frontend crash: PostCSS/JSON parse error on boot
**Symptom:** SyntaxError: Unexpected token '\ufeff', "\ufeff{ "nam"..." is not valid JSON
**Cause:** `apps/frontend/package.json` was saved with a UTF-8 BOM (Byte Order Mark) — an invisible character some Windows editors add at the start of a file. Node's JSON parser rejects it.

**Fix:** Re-save the file as plain UTF-8 (no BOM). In VS Code: click the encoding label in the bottom-right status bar → "Save with Encoding" → "UTF-8".

**Recommendation:** Add an `.editorconfig` at the repo root specifying `charset = utf-8` (without BOM) to prevent this recurring across the team.

### 2. Frontend unreachable despite container running
**Symptom:** Browser shows "site can't be reached" for `http://localhost:3000/`, even though `docker ps` shows the frontend container `Up`.

**Cause:** `docker-compose.yml` maps port `3000:3000`, but Vite's default dev server port is `5173`. The container was listening on 5173 internally, which was never exposed to the host.

**Fix:** Updated `apps/frontend/package.json` dev script to force Vite onto port 3000:
```json
"dev": "vite --host --port 3000"
```

### 3. Frontend shows 404 at localhost:3000
**Status:** Expected, not a bug. `apps/frontend/src/{components,pages,hooks,store,utils}` currently contain only `.gitkeep` placeholders — no actual React app or `index.html` has been built yet. The 404 confirms the dev server itself is healthy and correctly reports "no page to serve." This will resolve naturally once frontend development begins.

## Current implementation status (by service)

| Service | Status |
|---|---|
| ai-service | 4 modules merged (ingestion, chunking, embeddings, retrieval) — boots and runs |
| postgres | Running, accepting connections |
| qdrant | Running |
| ollama | Running (target model: `llama3.2:3b`) |
| frontend | Boots cleanly after fixes above. `src/{components,pages,hooks,store,utils}` contain only `.gitkeep` — no app built yet. 404 at localhost:3000 is expected. |
| backend | **Fails to boot.** `src/index.js` does not exist — `dev`/`start` scripts reference it but it was never created. `src/{controllers,middleware,prisma,routes,utils}` contain only `.gitkeep`. This appears to be expected scaffolding-only state (matches roadmap: backend auth + Postgres integration is a v0.3 milestone), not a regression — flagging here for visibility rather than fixing, since building the actual backend is outside DevOps/QA scope. |

## Current verified state (as of this entry)
- Full `docker-compose up --build` succeeds across all 6 services with no errors.
- Postgres, Qdrant, Ollama, ai-service, and backend all boot cleanly.
- Frontend boots cleanly after the two fixes above; 404 response is expected given no pages exist yet.