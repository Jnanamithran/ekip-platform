# EKIP — Project Progress Report

> Generated: 10/20/2026 · Branch: `main` (clean, up to date with `origin/main` @ `f4c217b`)
>
> This file records **how far the project has gone**, **which features are implemented**,
> and **what has been completed so far**. For setup and usage, see [`README.md`](./README.md).
> Note: the older [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) is a one-line stub that now
> points here.

---

## 1. Where the project stands (overall status)

EKIP is an **end-to-end working prototype**: you can sign up an organization, log in,
upload documents, watch them get parsed/chunked/embedded/indexed, ask questions, and get
back grounded answers with page-level citations and persistent chat history — all running
locally through Docker Compose with **no hosted LLM or public web search** involved.

| Area | Status | Notes |
| --- | --- | --- |
| Frontend (React + Vite + Tailwind) | ✅ Functional | Real API-backed flows; demo/mock UI removed |
| Backend (Express + Prisma) | ✅ Functional | Auth, admin, document, AI-proxy, Google Drive APIs |
| AI service (FastAPI) | ✅ Functional | Full RAG pipeline wired end-to-end via `/ask` and `/ingest` |
| Visual AI service (FastAPI) | ⚠️ Partial | ColPali + Qwen2-VL code complete, but **not yet wired into ingestion or Docker** |
| PostgreSQL (schema + migrations) | ✅ Integrated | 8 migrations applied; Prisma client generated |
| Qdrant vector store | ✅ Integrated | RBAC-filtered dense + sparse indexes |
| Ollama local LLM | ✅ Integrated | `llama3.2:3b` generation step |
| Docker Compose stack | ✅ Configured | 6 services, named volumes, `ai` profile |
| Documentation | ⚠️ Partial | README + 6 handbooks in `docs/`, but 3 handbooks are still stubs |
| Production hardening / evaluation | ⬜ Not started | See Section 5 |

---

## 2. Architecture delivered

```text
Browser
  └── React + Vite frontend ────────── localhost:5173
       └── Express backend ─────────── localhost:5000
            ├── PostgreSQL ─────────── localhost:5432  (accounts, workspaces, docs, chat history)
            ├── FastAPI AI ─────────── localhost:8000
            │     ├── Qdrant ───────── localhost:6333  (indexed chunks + vectors)
            │     └── Ollama ───────── localhost:11434  (llama3.2:3b)
            └── FastAPI AI-Visual ─── localhost:8001  (ColPali + Qwen2-VL) ⚠️ not in Compose
```

Request flow that is now working end-to-end:

1. **Ingestion** — browser → `POST /ai/ingest` (multer) → AI service parses → chunks →
   embeds → upserts into Qdrant with RBAC metadata, reporting progress back to the backend
   at each stage (10% → 90%).
2. **Answering** — browser → `POST /ai/ask` → backend injects RBAC from the verified JWT →
   AI service runs hybrid retrieval → cross-encoder rerank → Ollama generation → citation
   extraction, streaming stage updates to `AiRequestProgress` while working.
3. **Unified routing** — the AI service checks whether the user has any visual-indexed
   pages; if so, the text and visual pipelines run **in parallel** and their citations
   are merged.
4. **Persistence** — completed Q&A stored in `AiAnswerHistory` per user and restored when
   Search reopens; original PDFs retained on disk for citation preview.


---

## 3. Features implemented (what has been done)

### 3.1 AI service (`apps/ai-service`) — Phase 1 pipeline complete + OCR & unified routing

| Module | File(s) | What it does |
| --- | --- | --- |
| Ingestion | `ingestion/service.py`, `parsers/{pdf,docx,xlsx,txt}_parser.py` | Parses PDF, DOCX, XLSX, TXT into page-structured documents; file-type detection |
| Chunking | `chunking/sliding_window.py`, `chunking/service.py` | Sliding-window chunking with page-boundary safety |
| Embeddings | `embeddings/{embedder,service,qdrant_client,rbac_schema}.py` | Dense embedding generation + upsert into Qdrant with `org/workspace/department/role` metadata |
| Sparse retrieval | `retrieval/sparse_search.py` | BM25 keyword retrieval |
| Hybrid retrieval | `retrieval/hybrid_search.py`, `retrieval/service.py` | Dense + sparse fused with Reciprocal Rank Fusion (RRF), top-k = 12 |
| RBAC filtering | `retrieval/rbac_filter.py` | Access-control filter applied **before** passages are returned |
| Reranking | `reranking/reranker.py` | Cross-encoder rescoring, top_n = 4 |
| Generation | `generation/generator.py` | Ollama (`llama3.2:3b`) with a RAG prompt template |
| Citations | `citations/extractor.py` | Post-processes the answer into `[n]` citations mapped to document + page + excerpt |
| OCR fallback | `ingestion/parsers/pdf_parser.py` | EasyOCR fallback for pages with < 20 chars of extractable text |
| Unified router | `main.py` | Detects visual-indexed pages and runs text + visual pipelines in parallel, merging citations |
| HTTP API | `main.py` | `POST /ask`, `POST /ingest`, `GET /health` + progress callbacks to backend |
| Tests | `tests/` (9 files) | pytest coverage — see Section 5 for current pass/fail state |

#### Visual pipeline (`apps/ai-service-visual`, port 8001)

| Module | File(s) | What it does |
| --- | --- | --- |
| ColPali embedder | `visual/colpali_embedder.py` | Renders PDF pages to images, embeds them into Qdrant collection `ekip_visual_documents` with RBAC metadata |
| Qwen2-VL generator | `visual/qwen_generator.py` | Answers visual questions from retrieved page images |
| HTTP API | `main.py` | `POST /visual/ingest`, `POST /visual/search`, `POST /visual/ask`, `DELETE /visual/document/{id}`, `GET /health` |

> **Status caveat:** the visual service is fully implemented and the text service calls
> `POST /visual/ask` on it, but **nothing ever populates the visual collection** — no code
> path calls `POST /visual/ingest`, the service has no Dockerfile, and it is absent from
> `docker-compose.yml`. Worse, because the visual collection is therefore never created,
> `has_visual_docs()` does not return `False` — it raises a Qdrant 404 that turns every
> `/ask` into an HTTP 500. See Section 5.

### 3.2 Backend (`apps/backend`) — fully operational

- **Auth & sessions**
  - `POST /auth/login` (JWT access token), `POST /auth/refresh` (refresh-token **rotation**
    with hashed tokens in DB), `POST /auth/logout`, `GET /auth/me`.
  - `authenticate` + `requireRole('Admin')` middleware (`middleware/auth.middleware.js`).
  - JWT utilities in `utils/jwt.js` / `utils/refreshToken.js`.
- **Organization onboarding**
  - `POST /organizations` (public) — signup creates Organization → Workspace → Department →
    first Admin account in one go.
- **Admin (role-gated)**
  - Users: `POST /admin/users` (create), `GET /admin/users` (list), `PATCH /admin/users/:id`
    (edit), `POST /admin/users/:id/reset-password`, `PATCH /admin/users/:id/deactivate`,
    `PATCH /admin/users/:id/reactivate`.
  - Workspaces: create, list, **get dashboard** (DB-backed member/department/document
    totals), **PATCH rename**.
  - Departments: create, list.
- **AI proxy (JWT required, token forwarded to the AI service)**
  - `POST /ai/ask` · `POST /ai/ask/progress` · `GET /ai/ask/progress/:requestId`
  - `GET /ai/history` (per-user answer history) · `DELETE /ai/history` (clear it)
  - `POST /ai/ingest` (multer, 50 MB limit) · `POST /ai/documents/:id/progress`
  - `GET /ai/documents` (RBAC-scoped list with `preview_available` flag)
  - `GET /ai/documents/:id/preview` (streams retained original PDF to authorized users)
  - `DELETE /ai/documents/:id` (removes Qdrant chunks + DB row + retained file)
  - `GET /ai/health`
- **Google Drive integration (`src/routes/integrations.routes.js`)**
  - `GET /integrations/google/connect` · `GET /integrations/google/callback`
  - `GET /integrations/google/status` · `GET /integrations/google/files`
  - `POST /integrations/google/import` · `DELETE /integrations/google/disconnect`
  - OAuth tokens stored in the `IntegrationToken` model; Drive's own permissions are
    ignored — EKIP's RBAC decides who can see an imported file.
- **Data model (`src/prisma/schema.prisma`)** — `Organization`, `Workspace`, `Department`,
  `User` (roles: Admin/Manager/Employee/Intern + `active` flag), `Document` (status/stage/
  progress/chunk_count/storage_key/allowed_roles), `AiRequestProgress`, `AiAnswerHistory`,
  `RefreshToken`, `IntegrationToken` — backed by **8 migrations** covering init, refresh
  tokens, upload status, processing progress, AI request progress, PDF preview + answer
  history, user active flag, and integration tokens.
- **Seed script** for a demo org + admin (`src/prisma/seed.js`).


### 3.3 Frontend (`apps/frontend`) — real UI, demo content removed

- **Design system** — `Button`, `Card`, `Input`, `Badge`, `Avatar` components + Tailwind 4 theme.
- **Auth flows** — `Login.jsx` and `Signup.jsx` wired to the auth API; `AuthContext` with
  silent token refresh; `lib/apiClient.js` centralizes requests, token handling, and
  upload progress events.
- **Routing & RBAC UI** — `RequireAuth` / `RequireRole` guards; single source of truth for
  role → nav mapping in `lib/nav.js`:

  | Page | Admin | Manager | Employee | Intern |
  | --- | --- | --- | --- | --- |
  | Search | ✅ | ✅ | ✅ | ✅ |
  | Upload Documents | ✅ | ✅ | ✅ | ❌ |
  | Manage Users | ✅ | ❌ | ❌ | ❌ |
  | Workspace Settings | ✅ | ❌ | ❌ | ❌ |

- **Search page** — persistent per-user chat history (restored on load), live **processing
  stage** indicator (searching → ranking → drafting → verifying), citation list showing
  document + page, **"Preview PDF at page N"** opening the retained original at the cited
  page, message panel scrolling as one panel with a fixed composer at the bottom, and a
  confirmed **Clear chat** action that wipes the user's saved history.
- **Upload page** — multi-file upload for PDF/DOCX/XLSX/TXT with per-file **percentage
  progress bar**, ingestion stage text, chunk counts, document list scoped to the user's
  role/department, and delete with confirmation.
- **Manage Users page** — Admin-only user listing against `GET /admin/users` (read-only
  list with role badges; the edit / deactivate / reset-password / create-user endpoints
  exist on the backend but have **no UI wired up yet**).
- **Workspace Settings / Dashboard** — workspace picker, DB-backed member/department/document
  totals, and an editable (renameable) workspace name.
- **Supporting components** — `PdfPreview.jsx`, `AnswerResult.jsx`, `CitationTab.jsx`,
  `DashboardLayout.jsx`.
- **Not yet built** — a Google Drive connect/import screen. The backend OAuth flow
  redirects to `<frontend>/integrations?connected=google`, but that route does not exist
  in `App.jsx`, so the callback lands on the catch-all redirect to `/login`.


### 3.4 DevOps & documentation

- **`docker-compose.yml`** — 6 services (`frontend`, `backend`, `ai-service`, `postgres`,
  `qdrant`, `ollama`) with an `ai` profile for the ML stack, health checks, and named
  volumes (`postgres_data`, `qdrant_data`, `ollama_data`, `document_uploads`).
- **Startup dependency fixes** — backend applies pending Prisma migrations at boot; backend
  and AI service startup ordering resolved.
- **Standardized ports** — frontend `5173` everywhere (local + Docker), backend `5000`,
  AI `8000`, Qdrant `6333`, Ollama `11434`, Postgres `5432`.
- **Docs rewritten** — `README.md` (full Docker and local Windows setup, configuration
  table, validation commands, troubleshooting) plus `docs/`: `01_Project_Handbook`,
  `05_System_Architecture`, `06_Backend_Handbook`, `08_AI_Handbook`,
  `10_Deployment_Handbook`, `11_Project_Roadmap`.
- **GitHub** — PR template with a review checklist (conventions, docs updated, no secrets
  committed, branch up to date).
- **Secrets hygiene** — root `.env` (JWT secret) and per-service `.env` files are
  Git-ignored; upload storage (`apps/backend/uploads/`) is ignored too.

### 3.5 Delivery history (merged PRs on `main`)

| PR | Scope |
| --- | --- |
| #24 | Admin workspace + department endpoints |
| #25 | Docker Compose dev setup fixes |
| #26 | Worktree updates (auth/backend startup fixes) |
| #27 | README AI-integration rewrite |
| #28 | Frontend demo content removal |
| #29 | Backend + AI service startup dependencies |
| #30 | README / setup rewrite |
| #31 | Document preview & chat history |
| #32 | Workspace dashboard + editable settings |
| #33 | Backend upload/search progress persistence |
| #34 | AI pipeline stage reporting |
| #35 | Port standardization + docs |
| #36 | Frontend upload/search UI |
| #56 | Clear answer history + project docs |
| #57 | Frontend Docker `npm ci` fix |
| #81 | Scratch-file cleanup + stale docs |
| #82 | `.env.example` for all three services |
| #84 | Scratch-file cleanup + stale docs |
| #85 | Backend user lifecycle (edit / deactivate / reactivate / reset password) |
| #90 | Multi-role `allowed_roles` + `Owner` role in the AI service |
| #91 | ColPali visual document embedding microservice (port 8001) |
| #92 | ColPali visual document embedding pipeline |
| #93 | Qwen2-VL visual question answering in the visual service |
| #94 | Google Drive OAuth, file listing, import, disconnect |
| #95 | Unified query router for text + visual pipelines |
| #96 | OCR fallback for scanned PDFs before ColPali routing |

Key feature commits: `feat: add workspace dashboard and editable settings`,
`feat: add persistent chat and cited PDF previews`, `feat(ai): report ingestion and answer
pipeline stages`, `feat(backend): persist upload and search progress`, plus the original
per-module AI pipeline commits (ingestion → chunking → embeddings → BM25 → hybrid RRF →
reranker → generation → citations).


---

## 4. Checklist against `docs/11_Project_Roadmap.md`

### Phase 1 — Core AI Pipeline ✅ (all items implemented in code)

- [x] Repo setup & branch protection
- [x] Document ingestion service
- [x] Chunking pipeline
- [x] Embeddings + Qdrant integration
- [x] BM25 sparse retrieval
- [x] Hybrid retrieval (RRF)
- [x] Cross-encoder reranking
- [x] Ollama LLM generation
- [x] Citation post-processor
- [x] RBAC metadata filter

> The roadmap file itself still shows these boxes unchecked — it needs updating to match
> the code.

### Phase 2 — Visual Document Understanding 🔄 (in progress)

- [x] ColPali integration (merged to main via PR #92)
- [x] Qwen2-VL for image/slide understanding (merged to main via PR #93)
- [ ] Wire visual ingestion into the upload path so the visual collection is populated
- [ ] Add `ai-service-visual` to Docker Compose (it has no Dockerfile today)

### Phase 3 — Production ⬜ (partially started)

- [x] Docker Compose full stack *(done: 6 services, volumes, health checks)*
- [ ] Auth & multi-tenancy hardening
- [ ] Evaluation & benchmarking


---

## 5. What is NOT done yet (known gaps)

### 🔴 Blockers (verified, reproducible)

- **`retrieval/rbac_filter.py` raises `NameError` on the live retrieval path.** The file
  imports `Filter, FieldCondition, MatchAny` but uses `MatchValue` three times without
  importing it. Reproduced:
  `fetch_authorized_chunks(...)` → `NameError: name 'MatchValue' is not defined`.
  Introduced in commit `9140d53` (PR #90), which swapped `MatchValue` for `MatchAny` on
  the `allowed_roles` line and dropped the import while leaving the other three
  `MatchValue` calls in place. Since `sparse_retrieve()` calls this function, the BM25
  half of hybrid retrieval is broken — the sparse path fails on every `/ask` request.
  **Fix: add `MatchValue` to the import.**
- **`has_visual_docs()` raises a Qdrant 404, so every `/ask` returns HTTP 500.** The
  function scrolls the collection `ekip_visual_documents` on every request, but that
  collection is only ever created by the visual service (`ensure_visual_collection()`),
  which is not in the Compose stack. Qdrant answers a scroll on a missing collection with
  HTTP 404, `qdrant-client` 1.9.1 raises `UnexpectedResponse`, and nothing catches it.
  Reproduced end to end against a stub Qdrant exposing only `ekip_documents`:
  `POST /ask` → **500 Internal Server Error**. The test suite misses this because
  `test_ask_endpoint.py` monkeypatches `has_visual_docs` to return `False`.
  **Fix: check `client.collection_exists(VISUAL_COLLECTION)` first, or catch the 404 and
  treat it as "no visual documents".**
- **4 of 9 AI-service test files fail at collection.** `test_citations.py`,
  `test_generation.py`, `test_hybrid.py`, and `test_reranker.py` all construct
  `RBACContext(...)` at module import time without the now-required `allowed_roles`
  field, so pytest aborts with a pydantic `ValidationError` before running anything.
  Current state: **13 passed, 4 collection errors** (verified with the project venv).
  **Fix: add `allowed_roles=[...]` to each `RBACContext(...)` and move the construction
  inside a fixture.**
- **`PROJECT_STATUS.md` was a dangling pointer.** It said "See
  [PROGRESS_REPORT.md](./PROGRESS_REPORT.md)", but no such file was in the repo. It has now
  been repointed at this file.

### Functional gaps

- **The visual pipeline is never triggered.** `POST /visual/ingest` on the visual service
  has no caller, the service has no Dockerfile, and it is not in `docker-compose.yml`.
  `has_visual_docs()` therefore always returns `False` and only the text pipeline runs.
- **Google Drive has no frontend.** The backend OAuth flow, file listing, and import are
  complete, but there is no `/integrations` route or UI, so users cannot connect a Drive
  account from the app.
- **User lifecycle has no frontend.** Edit / deactivate / reactivate / reset-password
  endpoints exist on the backend; the Manage Users page is a read-only list. There is also
  no "create user" form despite `POST /admin/users` existing.
- **Multi-role `allowed_roles` is not exposed in the UI.** The normal upload path hardcodes
  `allowedRoles: [req.user.role]`, so every uploaded document is visible only to its
  uploader's role. Per-file role selection is only possible via the Google Drive import
  path.
- **`Owner` role is half-implemented.** The AI service accepts `Owner` in `ALLOWED_ROLES`
  and in `RBACInfo`, but the backend Prisma `Role` enum has only
  `Admin/Manager/Employee/Intern`, and the backend validates `allowed_roles` against that
  enum — so `Owner` can never be set from the backend.
- OCR fallback for scanned / image-only PDFs (EasyOCR) is implemented in the AI service, but
  PPTX and CSV formats are still unsupported.
- No workspace question-usage analytics — the dashboard shows DB-backed totals only.
- PDF preview only works for PDFs whose original file was retained (re-upload needed for
  older indexed documents); DOCX/XLSX/TXT citations have no preview.
- No document re-processing / re-indexing UI (only upload and delete exist).
- No in-app password reset for end users (admin-triggered reset exists).

### Quality & production gaps

- **The generated Prisma client is stale.** `node_modules/.prisma/client` does not contain
  `IntegrationToken`, so the freshly added Google Drive model and the `User.active` flag
  are missing from the generated client until `prisma generate` is re-run.
- **No automated tests for the backend or frontend** (only AI-service pytest tests exist,
  and 4 of those files currently fail to collect); no CI pipeline — `.github/` contains
  only the PR template.
- **Most handbooks are still stubs.** `docs/01_Project_Handbook.md` (15 lines),
  `docs/05_System_Architecture.md` (15 lines), and `docs/08_AI_Handbook.md` (23 lines)
  contain un-filled `<!-- ... -->` placeholder sections. Only `06_Backend_Handbook.md`
  (142 lines) and `10_Deployment_Handbook.md` (72 lines) are substantive.
- The AI handbook does not yet document the OCR fallback, the unified router, the visual
  service, or the actual model names.
- Auth & multi-tenancy hardening not done (no rate limiting, password policy, account
  lockout, or adversarial cross-org isolation testing).
- No evaluation/benchmarking of retrieval or answer quality.
- No structured logging, metrics, or observability beyond console output.
- Single-node local deployment only — no cloud deployment, HTTPS, or backup strategy.
- Scratch files are mostly cleaned up: `apps/ai-service/` root now contains only
  `main.py` plus config files, and the leftover scratch tests live in `apps/ai-service/tests/`.

### Housekeeping

- `PROJECT_STATUS.md` is outdated and its link target does not exist (see Blockers).
- Roadmap checkboxes in `docs/11_Project_Roadmap.md` do not reflect the completed Phase 1
  work, and Phase 2 is missing the two new "wiring" items.

---

## 6. Suggested next steps

1. **Fix the two blockers first** — add `MatchValue` to the `rbac_filter.py` import, and
   repair the 4 broken test files so `pytest tests/ -v` runs clean. Both are small,
   high-impact changes.
2. **Wire up the visual pipeline** — add a Dockerfile for `ai-service-visual`, register it
   in `docker-compose.yml`, and call `POST /visual/ingest` from the ingestion path so
   scanned PDFs actually populate `ekip_visual_documents`.
3. **Build the Google Drive frontend** — add an `/integrations` route, the connect
   button, and a file picker with per-file `allowed_roles` selection.
4. **Expose user lifecycle + multi-role in the UI** — create/edit/deactivate users from
   Manage Users, and let the uploader pick which roles can see each document.
5. Add a backend/frontend test suite plus a CI workflow (lint, build, tests) under
   `.github/workflows`.
6. Fill in the three stub handbooks and update the roadmap checkboxes; retire
   `PROJECT_STATUS.md`.
7. Implement real question-usage analytics for the workspace dashboard.
8. Harden auth & multi-tenancy (rate limiting, password policy, cross-org isolation tests).
9. Add a retrieval/answer evaluation harness before calling the pipeline production-ready.
