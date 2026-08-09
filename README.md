# EKIP — Enterprise Knowledge Intelligence Platform

> Final Year Engineering Project · B.Tech Computer Science · KTU

EKIP is a multi-tenant enterprise knowledge platform that eliminates the hours employees waste searching across disconnected document systems. Upload PDFs, Word docs, and Excel sheets into one platform — then query everything in plain English and get trustworthy, source-cited answers in seconds, with access strictly enforced by role.

This is **not** a PDF chatbot. It is a full enterprise knowledge operating system with role-based access control, hybrid retrieval, reranking, and citation-backed responses — built entirely on locally hosted AI with no external API dependency.

---

## The Problem

Organizations store knowledge across multiple disconnected systems:

- PDFs, Word documents
- Excel sheets
- Internal documentation and handbooks

Employees waste hours searching across all of them. Traditional keyword search doesn't understand meaning. And nobody can tell if the answer is actually correct — there are no sources, and no access control.

**EKIP solves this.** One platform. One search. Role-enforced. Always cited.

---

## Platform Overview

```
Organization
└── Workspace
    └── Department
        └── Users (Admin · Manager · Employee · Intern)
            └── Documents (access enforced by role, before retrieval)
```

Every user belongs to a department with a role. Their role determines which documents they can search. **RBAC is enforced before retrieval** — unauthorized documents never reach the AI, not even to be filtered out afterwards. This is a structural guarantee, not a post-hoc check.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│               React · Vite · Tailwind            │  Frontend    (port 3000)
└──────────────────────┬──────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────┐
│         Node.js · Express · Prisma · JWT         │  Backend     (port 5000)
│              PostgreSQL · RBAC Middleware         │
└────────────┬────────────────────────────────────┘
             │ Internal HTTP (RBAC context passed on every call)
┌────────────▼─────────────────────────────────────┐
│     Python · FastAPI · Sentence Transformers      │  AI Service  (port 8000)
│     BM25 · RRF · Qdrant · Ollama · Reranker      │
└───────────────────────────────────────────────────┘
```

---

## Services

| Service    | Port  | Stack                                          | Status         |
|------------|-------|------------------------------------------------|----------------|
| Frontend   | 3000  | React, Vite, Tailwind CSS                      | In progress    |
| Backend    | 5000  | Node.js, Express.js, Prisma, PostgreSQL, JWT   | In progress    |
| AI Service | 8000  | Python, FastAPI, Sentence Transformers, Ollama | ✅ Core built   |
| Qdrant     | 6333  | Vector database                                | ✅ Running      |
| PostgreSQL | 5432  | Relational database                            | ✅ Running      |
| Ollama     | 11434 | Local LLM runtime (model: llama3.2:3b)         | ✅ Running      |

---

## AI Pipeline (Phase 1)

```
Document Upload (PDF · DOCX · XLSX · TXT)
      ↓
File Type Detection
(extension + magic byte signature verification — catches renamed/mislabeled files)
      ↓
Text Extraction per page
(PyMuPDF for PDF, python-docx for DOCX, openpyxl for XLSX)
(Scanned/image-only PDFs flagged → reserved for Phase 2 ColPali handling)
      ↓
Sliding Window Chunking
(200 words/chunk, 40-word overlap, never crossing page boundaries)
(Page-boundary safety ensures every chunk maps to exactly one source page for citation)
      ↓
Dense Embeddings
(Sentence Transformers: all-MiniLM-L6-v2, 384-dim vectors → Qdrant)
(RBAC metadata attached at write time: org_id, workspace_id, department_id, allowed_roles)
      +
Sparse Embeddings (BM25)
      ↓
RBAC Metadata Filter ← user's org/workspace/department/role checked HERE
(Qdrant metadata-only query returns only authorized chunks — no vector search yet)
(BM25 index built in-memory from this authorized set only — never scores unauthorized content)
      ↓
Hybrid Retrieval (Reciprocal Rank Fusion)
(Fuses dense + sparse ranked lists by rank position, not raw score)
      ↓
Cross-Encoder Reranking
(Re-scores top RRF candidates for final precision before LLM)
      ↓
Ollama LLM Generation (llama3.2:3b)
(Grounded strictly in retrieved context — no hallucination from model's general knowledge)
      ↓
Citation Post-Processor
(Maps each claim in the generated answer back to exact source chunk, filename, and page number)
      ↓
Answer + Sources
```

### Supported File Types (Phase 1)

| Format | Parser     | Notes                                                                 |
|--------|------------|-----------------------------------------------------------------------|
| PDF    | PyMuPDF    | Text-based only. Scanned/image PDFs flagged for Phase 2.             |
| DOCX   | python-docx| Paragraphs + table content extracted. Batched into pseudo-pages.     |
| XLSX   | openpyxl   | Row-per-unit extraction. Sheet name + headers preserved per row.     |
| TXT    | Built-in   | Multi-encoding fallback: UTF-8 → cp1252 → latin-1.                  |

> ⚠️ PPTX and CSV are **not** supported in Phase 1. PPTX is a Phase 2 target (ColPali handles slide layouts visually). CSV will be added alongside NL-to-SQL in Phase 2.

---

## Phase 2 — Multimodal Intelligence (Planned)

Phase 2 builds on the Phase 1 pipeline to handle documents where meaning lives in layout, not just text:

- **ColPali** — vision-based page embeddings; treats each PDF page as an image, handles scanned documents, charts, complex tables, and visual layouts that text extraction destroys
- **Qwen2-VL** — multimodal LLM for answering questions about chart images, figures, and scanned page content
- **NL-to-SQL** — structured database querying from plain English
- **Document comparison** — diff citations across versions of the same document
- **PPTX + CSV support** — rounds out the document type coverage

---

## Why Local Models

EKIP prioritizes locally hosted AI:

- Enterprise data never leaves the server
- No model training on company documents
- Better compliance posture
- Zero per-query API cost at scale

LLM: `llama3.2:3b` via Ollama. Embedding model: `all-MiniLM-L6-v2` (Sentence Transformers, 384-dim). Both run fully locally.

---

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/) — WSL 2 backend required on Windows
- Git

### Run with Docker

```bash
# Clone the repository
git clone https://github.com/Jnanamithran/ekip-platform.git
cd ekip-platform

# Start all services
docker-compose up --build
```

First-time boot will be slow — the `ollama/ollama` image alone is ~3.2GB, and `ai-service` installs several large Python packages (notably `torch`). Subsequent boots use cached layers and are much faster.

After boot, pull the LLM model into the Ollama container (required once):

```bash
docker exec -it <ollama-container-name> ollama pull llama3.2:3b
```

| Service    | URL                       |
|------------|---------------------------|
| Frontend   | http://localhost:3000     |
| Backend    | http://localhost:5000     |
| AI Service | http://localhost:8000     |
| Qdrant UI  | http://localhost:6333     |

> **Note:** The backend (`src/index.js`) is not yet implemented — this is expected per the roadmap (v0.3 milestone). The backend container will fail to start until that work lands. All other services boot cleanly.

### AI Service (local development without Docker)

```bash
cd apps/ai-service

# Create venv using Python 3.11 specifically
# (Python 3.14+ lacks prebuilt wheels for pymupdf and sentence-transformers)
py -3.11 -m venv venv
.\venv\Scripts\Activate.ps1   # Windows
source venv/bin/activate      # Linux/Mac

pip install -r requirements.txt
```

---

## Project Structure

```
ekip-platform/
├── apps/
│   ├── ai-service/        # Python · FastAPI · Qdrant · Ollama
│   │   ├── ingestion/     # ✅ File type detection + text extraction
│   │   ├── chunking/      # ✅ Sliding window chunker
│   │   ├── embeddings/    # ✅ Sentence Transformers + Qdrant storage
│   │   ├── retrieval/     # ✅ BM25 + RBAC filter
│   │   ├── reranking/     # ⬜ Cross-encoder (in progress)
│   │   ├── generation/    # ⬜ Ollama generation (in progress)
│   │   └── citations/     # ⬜ Citation post-processor (in progress)
│   ├── backend/           # ⬜ Node.js · Express · Prisma (v0.3)
│   └── frontend/          # ⬜ React · Vite · Tailwind (v0.4)
├── docs/
│   ├── 01_Project_Handbook.md
│   ├── 02_Development_Handbook.md
│   ├── 03_Git_and_GitHub_Handbook.md
│   ├── 04_AI_Assisted_Development_Handbook.md
│   ├── 05_System_Architecture.md
│   ├── 06_Backend_Handbook.md
│   ├── 07_Frontend_Handbook.md
│   ├── 08_AI_Handbook.md
│   ├── 09_Database_and_Testing_Handbook.md
│   ├── 10_Deployment_Handbook.md
│   ├── 11_Project_Roadmap.md
│   └── 12_Feature_Handbook.md
├── docker-compose.yml
├── .editorconfig          # Enforces UTF-8 (no BOM), LF line endings across the team
└── .github/
    └── PULL_REQUEST_TEMPLATE.md
```

---

## Documentation

| Handbook | Description |
|----------|-------------|
| [Project Handbook](docs/01_Project_Handbook.md) | Vision, goals, team philosophy |
| [System Architecture](docs/05_System_Architecture.md) | Full system design, component interactions, data flow |
| [Backend Handbook](docs/06_Backend_Handbook.md) | API routes, auth, RBAC, request/response formats |
| [Frontend Handbook](docs/07_Frontend_Handbook.md) | Components, pages, protected routes, UX flows |
| [AI Handbook](docs/08_AI_Handbook.md) | Pipeline design, retrieval strategy, model decisions, evaluation |
| [DB & Testing Handbook](docs/09_Database_and_Testing_Handbook.md) | Schema, migrations, indexes, test coverage |
| [Deployment Handbook](docs/10_Deployment_Handbook.md) | Docker Compose setup, known issues and fixes |
| [Project Roadmap](docs/11_Project_Roadmap.md) | Phase 1 versions (v0.1–v0.5) and Phase 2 milestones |

---

## Versioning

Phase 1 is built continuously on `main` and checkpointed at 5 git-tagged versions tied to department presentations:

| Tag   | Name | What it proves |
|-------|------|----------------|
| v0.1  | Core AI Pipeline | Ingest → chunk → embed → RBAC-filtered retrieval |
| v0.2  | AI Reasoning Complete | Hybrid retrieval + reranking + generation + citations |
| v0.3  | Auth + Multi-tenancy | Real JWT auth, Postgres schema, RBAC from live sessions |
| v0.4  | Usable Product | Full React UI — login, upload, search, cited answers |
| v0.5  | Phase 1 Complete | Full docker-compose stack verified, CI green, docs done |

To check out a version for demo:

```bash
git checkout v0.2   # detached HEAD — safe for demo, not for editing
git checkout main   # return to active development
```

---

## Git Workflow

`main` is **protected**. No direct pushes. All changes go through a feature branch and a reviewed Pull Request.

```bash
git checkout main && git pull origin main
git checkout -b ai/your-feature-name
# write code, test it, document it
git add .
git commit -m "feat(ai): short description"
git push origin ai/your-feature-name
# open Pull Request → request review from AI Lead → wait for approval
```

### Branch Naming

| Prefix      | Used For              | Example                        |
|-------------|-----------------------|--------------------------------|
| `ai/`       | AI pipeline work      | `ai/hybrid-retrieval-rrf`      |
| `backend/`  | Backend features      | `backend/auth-middleware`      |
| `frontend/` | Frontend features     | `frontend/chat-interface`      |
| `devops/`   | Infra, CI, testing    | `devops/github-actions-ci`     |
| `docs/`     | Documentation updates | `docs/update-ai-handbook`      |
| `fix/`      | Bug fixes             | `fix/qdrant-rbac-filter`       |
| `test/`     | Tests only            | `test/auth-integration`        |

### Commit Format

```
feat(ai): add hybrid retrieval with RRF fusion
fix(frontend): resolve port mismatch on docker boot
docs(deployment): document known issues and fixes
test(ingestion): add pytest coverage for PDF parser
chore(devops): add GitHub Actions CI pipeline
```

---

## Team

| Role | Owns |
|------|------|
| **AI Lead & Project Lead** | AI pipeline (all 9 steps), system architecture, PR reviews for all members, team coordination |
| **Backend Developer** | Express APIs, JWT auth, RBAC middleware, Postgres schema, AI service integration |
| **Frontend Developer** | React UI, Tailwind, protected routes, auth UX, citation display, role-aware views |
| **Database & Testing Engineer** | Prisma migrations, unit tests, CI/CD, docker-compose verification, RBAC leakage testing |

All PRs require review and approval from the AI Lead before merging.

---

## Roadmap

### Phase 1 — Core Platform (In Progress)

**v0.1 — Core AI Pipeline**
- [x] Repository setup, folder structure, branch protection
- [x] Document ingestion (PDF, DOCX, XLSX, TXT)
- [x] Sliding window chunking with page-boundary safety
- [x] Dense embeddings (all-MiniLM-L6-v2 → Qdrant, RBAC metadata at write time)
- [x] BM25 sparse retrieval + RBAC metadata filter (in-memory, scoped to authorized chunks only)

**v0.2 — AI Reasoning Complete**
- [ ] Hybrid retrieval (Reciprocal Rank Fusion of dense + sparse)
- [ ] Cross-encoder reranking
- [ ] Ollama LLM generation (llama3.2:3b) with structured prompt template
- [ ] Citation post-processor (maps answer claims to exact source chunks + pages)

**v0.3 — Auth + Multi-tenancy**
- [ ] PostgreSQL schema + Prisma migrations (Org → Workspace → Department → User)
- [ ] JWT authentication and RBAC middleware
- [ ] FastAPI endpoints exposed (/ingest, /query) — RBAC context from real sessions
- [ ] Backend Express API wired to AI service

**v0.4 — Usable Product**
- [ ] React dashboard with AI chat/search interface
- [ ] Document upload UI
- [ ] Results display with visible source citations
- [ ] Role-aware UI (Intern vs. Admin views differ)

**v0.5 — Phase 1 Complete**
- [ ] Full docker-compose stack verified end-to-end
- [ ] CI green across all services
- [ ] RBAC leakage tests passing
- [ ] All documentation complete

### Phase 2 — Multimodal Intelligence (Planned)
- [ ] ColPali integration (vision-based page embeddings for scanned docs)
- [ ] Qwen2-VL (multimodal LLM for charts, figures, and visual layouts)
- [ ] NL-to-SQL for structured database querying
- [ ] Document comparison with diff citations
- [ ] PPTX and CSV support

---

## License

This project is developed as a Final Year Engineering Project under KTU (APJ Abdul Kalam Technological University). All rights reserved.