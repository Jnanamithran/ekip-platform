# EKIP â€” Enterprise Knowledge Intelligence Platform

> Final Year Engineering Project | B.Tech Computer Science

EKIP is a multi-tenant enterprise knowledge platform that lets employees query
across disconnected document systems (PDF, Word, Excel, PowerPoint, databases)
through a single intelligent interface â€” with RBAC-enforced retrieval and
source-cited answers.

---

## Architecture

\\\
Frontend (React/Vite)
      â†“
Backend (Node/Express + PostgreSQL + Prisma)
      â†“
AI Service (FastAPI + Qdrant + Ollama)
\\\

## Services

| Service      | Port | Stack                              |
|--------------|------|------------------------------------|
| Frontend     | 3000 | React, Vite, Tailwind CSS          |
| Backend      | 5000 | Node.js, Express, Prisma, Postgres |
| AI Service   | 8000 | Python, FastAPI, Qdrant, Ollama    |
| Qdrant       | 6333 | Vector Database                    |
| PostgreSQL   | 5432 | Relational Database                |
| Ollama       | 11434| Local LLM runtime                  |

## Getting Started

\\\ash
# Clone
git clone https://github.com/<org>/ekip-platform.git
cd ekip-platform

# Start all services
docker-compose up --build
\\\

## Branching Convention

| Prefix       | Who          | Example                              |
|--------------|--------------|--------------------------------------|
| ai/          | AI Lead      | ai/hybrid-retrieval-rrf              |
| backend/     | Backend      | backend/auth-middleware              |
| frontend/    | Frontend     | frontend/search-ui                   |
| docs/        | Any          | docs/update-architecture             |

> **main is protected.** No direct pushes. All changes via PR + review.

## Docs

- [Project Handbook](docs/01_Project_Handbook.md)
- [System Architecture](docs/05_System_Architecture.md)
- [AI Handbook](docs/08_AI_Handbook.md)
- [Project Roadmap](docs/11_Project_Roadmap.md)

## Team

| Role          | Scope                                  |
|---------------|----------------------------------------|
| AI Lead       | AI pipeline, architecture, PR reviews  |
| Backend Dev   | API, auth, database, RBAC              |
| Frontend Dev  | React UI, search interface             |
| (4th member)  | TBD                                    |
