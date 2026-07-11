# EKIP — Enterprise Knowledge Intelligence Platform

> Final Year Engineering Project · B.Tech Computer Science · KTU

EKIP is a multi-tenant enterprise knowledge platform that eliminates the hours employees waste searching across disconnected document systems. Upload PDFs, Word docs, Excel sheets, PowerPoints, and structured databases into one platform — then query everything in plain English and get trustworthy, source-cited answers in seconds.

This is **not** a PDF chatbot. It is a full enterprise knowledge operating system with role-based access control, hybrid retrieval, explainable AI, and citation-backed responses.

---

## The Problem

Organizations store knowledge across multiple disconnected systems:

- PDFs, Word documents, PowerPoint decks
- Excel sheets and CSV exports
- SQL databases and internal documentation

Employees waste hours searching across all of them. Traditional search engines match keywords, not meaning. OCR-based tools destroy tables, charts, and visual layouts. And nobody can tell if the answer is actually correct — there are no sources.

**EKIP solves this.** One platform. One search. Role-enforced. Always cited.

---

## Platform Overview

```
Organization
└── Workspace
    └── Department
        └── Users (Admin · Manager · Employee · Intern)
            └── Documents (access enforced by role)
```

Every user belongs to a department with a role. Their role determines which documents they can search. RBAC is enforced **before** retrieval — unauthorized documents never reach the AI.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│               React · Vite · Tailwind            │  Frontend (port 3000)
└──────────────────────┬──────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────┐
│         Node.js · Express · Prisma · JWT         │  Backend  (port 5000)
│              PostgreSQL · RBAC                   │
└────────────┬─────────────────────────────────────┘
             │ Internal HTTP
┌────────────▼─────────────────────────────────────┐
│     Python · FastAPI · Sentence Transformers      │  AI Service (port 8000)
│     BM25 · RRF · Qdrant · Ollama · Reranker      │
└───────────────────────────────────────────────────┘
```

---

## Services

| Service    | Port  | Stack                                          |
|------------|-------|------------------------------------------------|
| Frontend   | 3000  | React, Vite, Tailwind CSS                      |
| Backend    | 5000  | Node.js, Express.js, Prisma, PostgreSQL, JWT   |
| AI Service | 8000  | Python, FastAPI, Sentence Transformers, Ollama |
| Qdrant     | 6333  | Vector database                                |
| PostgreSQL | 5432  | Relational database                            |
| Ollama     | 11434 | Local LLM runtime                              |

---

## AI Pipeline (Phase 1)

```
Document Upload
      ↓
Type Detection (PDF · DOCX · XLSX · PPTX · CSV)
      ↓
Text Extraction + Chunking (sliding window with overlap)
      ↓
Dense Embeddings (Sentence Transformers → Qdrant)
      +
Sparse Embeddings (BM25)
      ↓
RBAC Metadata Filter ← user role checked HERE, before any search
      ↓
Hybrid Retrieval (Reciprocal Rank Fusion)
      ↓
Cross-Encoder Reranking
      ↓
Ollama LLM Generation
      ↓
Citation Extraction → Answer with Sources
```

**Phase 2** (planned): ColPali + Qwen2-VL for visual document understanding — charts, scanned pages, figures, and complex layouts.

---

## Why Local Models

EKIP prioritizes locally hosted AI:

- Enterprise data never leaves the server
- No model training on company documents
- Better compliance posture
- Zero per-query API cost at scale

---

## Getting Started

### Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- [Ollama](https://ollama.ai/) (optional for local dev without Docker)

### Run with Docker

```bash
# Clone the repository
git clone https://github.com/Jnanamithran/ekip-platform.git
cd ekip-platform

# Start all services
docker-compose up --build
```

| Service    | URL                      |
|------------|--------------------------|
| Frontend   | http://localhost:3000    |
| Backend    | http://localhost:5000    |
| AI Service | http://localhost:8000    |
| Qdrant UI  | http://localhost:6333    |

---

## Project Structure

```
ekip-platform/
├── apps/
│   ├── frontend/          # React · Vite · Tailwind CSS
│   ├── backend/           # Node.js · Express · Prisma
│   └── ai-service/        # Python · FastAPI · Qdrant
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
| [AI Handbook](docs/08_AI_Handbook.md) | Pipeline design, retrieval strategy, evaluation |
| [DB & Testing Handbook](docs/09_Database_and_Testing_Handbook.md) | Schema, migrations, indexes, test coverage |
| [Project Roadmap](docs/11_Project_Roadmap.md) | Phase 1 and Phase 2 milestones |

---

## Git Workflow

`main` is **protected**. No direct pushes. All changes go through a feature branch and a reviewed Pull Request.

```bash
git checkout main && git pull origin main
git checkout -b feature/your-feature-name
# write code, test it, document it
git add .
git commit -m "feat(scope): short description"
git push origin feature/your-feature-name
# open Pull Request → tag reviewer → wait for approval
```

### Branch Naming

| Prefix      | Used For              | Example                        |
|-------------|-----------------------|--------------------------------|
| `ai/`       | AI pipeline work      | `ai/hybrid-retrieval-rrf`      |
| `backend/`  | Backend features      | `backend/auth-middleware`      |
| `frontend/` | Frontend features     | `frontend/chat-interface`      |
| `database/` | Schema & migrations   | `database/roles-migration`     |
| `docs/`     | Documentation updates | `docs/update-ai-handbook`      |
| `fix/`      | Bug fixes             | `fix/qdrant-rbac-filter`       |
| `test/`     | Tests only            | `test/auth-integration`        |

### Commit Format

```
feat(auth): add JWT login endpoint
fix(rbac): correct role filter order in Qdrant
docs(ai): document hybrid retrieval pipeline
test(db): add user creation unit tests
```

---

## Team

| Role | Owns |
|------|------|
| **AI Lead & Project Lead** | AI pipeline, system architecture, PR reviews, team coordination |
| **Backend Developer** | Express APIs, JWT auth, RBAC middleware, AI service integration |
| **Frontend & Security Developer** | React UI, Tailwind, protected routes, auth UX |
| **Database & Testing Engineer** | PostgreSQL schema, Prisma migrations, unit tests, QA |

---

## Roadmap

### Phase 1 — Core Platform
- [x] Repository setup and documentation structure
- [ ] PostgreSQL schema and Prisma migrations
- [ ] JWT authentication and RBAC
- [ ] Organization · Workspace · Department APIs
- [ ] Document upload pipeline
- [ ] Text chunking and embedding
- [ ] Hybrid retrieval (dense + sparse + RRF)
- [ ] Ollama LLM integration with citation extraction
- [ ] React dashboard with AI chat interface

### Phase 2 — Multimodal Intelligence
- [ ] ColPali integration (vision-based page embeddings)
- [ ] Qwen2-VL (multimodal LLM for charts and scanned documents)
- [ ] NL-to-SQL for structured database querying
- [ ] Document comparison with diff citations
- [ ] Advanced reranking with visual + text signals

---

## License

This project is developed as a Final Year Engineering Project under KTU (APJ Abdul Kalam Technological University). All rights reserved.