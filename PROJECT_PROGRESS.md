# EKIP — Project Progress Report

> Generated: 10/20/2026 · Branch: `main` (clean, up to date with `origin/main` @ `a7da0bb`)
>
> This file records **how far the project has gone**, **which features are implemented**,
> and **what has been completed so far**. For setup and usage, see [`README.md`](./README.md).
> Note: the older [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) is stale — it predates the
> backend and AI wiring work and no longer reflects reality.

---

## 1. Where the project stands (overall status)

EKIP is now an **end-to-end working prototype**: you can sign up an organization, log in,
upload documents, watch them get parsed/chunked/embedded/indexed, ask questions, and get
back grounded answers with page-level citations and persistent chat history — all running
locally through Docker Compose with **no hosted LLM or public web search** involved.

| Area | Status | Notes |
| --- | --- | --- |
| Frontend (React + Vite + Tailwind) | ✅ Functional | Real API-backed flows; demo/mock UI removed |
| Backend (Express + Prisma) | ✅ Functional | Auth, admin, document, AI-proxy APIs operational |
| AI service (FastAPI) | ✅ Functional | Full RAG pipeline wired end-to-end via `/ask` and `/ingest` |
| PostgreSQL (schema + migrations) | ✅ Integrated | 6 migrations applied; Prisma client generated |
| Qdrant vector store | ✅ Integrated | RBAC-filtered dense + sparse indexes |
| Ollama local LLM | ✅ Integrated | `llama3.2:3b` generation step |
| Docker Compose stack | ✅ Configured | 6 services, named volumes, `ai` profile |
| Documentation | ✅ Rewritten | README + 6 handbooks in `docs/` |
| Production hardening / evaluation | ⬜ Not started | See Section 5 |

---

## 2. Architecture delivered

```text
Browser
  └── React + Vite frontend ────────── localhost:5173
       └── Express backend ─────────── localhost:5000
            ├── PostgreSQL ─────────── localhost:5432  (accounts, workspaces, docs, chat history)
            └── FastAPI AI ─────────── localhost:8000
                 ├── Qdrant ────────── localhost:6333  (indexed chunks + vectors)
                 └── Ollama ────────── localhost:11434  (llama3.2:3b)
```

Request flow that is now working end-to-end:

1. **Ingestion** — browser → `POST /ai/ingest` (multer) → AI service parses → chunks →
   embeds → upserts into Qdrant with RBAC metadata, reporting progress back to the backend
   at each stage (10% → 90%).
2. **Answering** — browser → `POST /ai/ask` → backend injects RBAC from the verified JWT →
   AI service runs hybrid retrieval → cross-encoder rerank → Ollama generation → citation
   extraction, streaming stage updates to `AiRequestProgress` while working.
3. **Persistence** — completed Q&A stored in `AiAnswerHistory` per user and restored when
   Search reopens; original PDFs retained on disk for citation preview.


---

## 3. Features implemented (what has been done)

### 3.1 AI service (`apps/ai-service`) — Phase 1 pipeline complete

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
| HTTP API | `main.py` | `POST /ask`, `POST /ingest`, `GET /health` + progress callbacks to backend |
| Tests | `tests/test_ask_endpoint.py`, `test_ingest_endpoint.py`, `test_citation_extractor.py` | pytest coverage for the endpoints and citation extractor |

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
  - Users: `POST /admin/users` (create), `GET /admin/users` (list).
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
- **Data model (`src/prisma/schema.prisma`)** — `Organization`, `Workspace`, `Department`,
  `User` (roles: Admin/Manager/Employee/Intern), `Document` (status/stage/progress/
  chunk_count/storage_key/allowed_roles), `AiRequestProgress`, `AiAnswerHistory`,
  `RefreshToken` — backed by **6 migrations** covering init, refresh tokens, upload status,
  processing progress, AI request progress, and PDF preview + answer history.
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
- **Manage Users page** — Admin user listing/creation against the admin API.
- **Workspace Settings / Dashboard** — workspace picker, DB-backed member/department/document
  totals, and an editable (renameable) workspace name.
- **Supporting components** — `PdfPreview.jsx`, `AnswerResult.jsx`, `CitationTab.jsx`,
  `DashboardLayout.jsx`.


### 3.4 DevOps & documentation

- **`docker-compose.yml`** — 6 services (`frontend`, `backend`, `ai-service`, `postgres`,
  `qdrant`, `ollama`) with an `ai` profile for the ML stack, health checks, and named
  volumes (`postgres_data`, `qdrant_data`, `ollama_models`, `document_uploads`).
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
- [ ] Qwen2-VL for image/slide understanding (branch: ai/qwen2vl-visual-generation)

### Phase 3 — Production ⬜ (partially started)

- [x] Docker Compose full stack *(done: 6 services, volumes, health checks)*
- [ ] Auth & multi-tenancy hardening
- [ ] Evaluation & benchmarking


---

## 5. What is NOT done yet (known gaps)

**Functional gaps**

- No OCR — scanned / image-only PDFs yield no searchable text; PPTX and CSV formats are
  unsupported.
- No workspace question-usage analytics — the dashboard shows DB-backed totals only.
- PDF preview only works for PDFs whose original file was retained (re-upload needed for
  older indexed documents); DOCX/XLSX/TXT citations have no preview.
- No document re-processing / re-indexing UI (only upload and delete exist).
- No in-app user editing (no update/reset-password/deactivate flows — only create + list).

**Quality & production gaps**

- No automated tests for the backend or frontend (only AI-service pytest tests exist);
  no CI pipeline — `.github/` contains only the PR template.
- Auth & multi-tenancy hardening not done (no rate limiting, password policy, account
  lockout, or adversarial cross-org isolation testing).
- No evaluation/benchmarking of retrieval or answer quality.
- No structured logging, metrics, or observability beyond console output.
- Single-node local deployment only — no cloud deployment, HTTPS, or backup strategy.
- Scratch files remain in `apps/ai-service/` root (`demo.py`, `test_*.py`, sample
  `*.pdf` files) that should be cleaned up or moved.

**Housekeeping**

- `PROJECT_STATUS.md` is outdated (still claims the backend is a non-operational scaffold)
  and should be replaced by this file.
- Roadmap checkboxes in `docs/11_Project_Roadmap.md` do not reflect the completed Phase 1
  work.

---

## 6. Suggested next steps

1. Update `docs/11_Project_Roadmap.md` checkboxes and retire `PROJECT_STATUS.md`.
2. Add a backend/frontend test suite plus a CI workflow (lint, build, tests) under
   `.github/workflows`.
3. Implement real question-usage analytics for the workspace dashboard.
4. Start Phase 2 (ColPali / Qwen2-VL) for visual document understanding, or add OCR for
   scanned PDFs.
5. Harden auth & multi-tenancy (rate limiting, password policy, cross-org isolation tests).
6. Add a retrieval/answer evaluation harness before calling the pipeline production-ready.
