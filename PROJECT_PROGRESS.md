# EKIP Project Progress

> Last reviewed: 2026-10-21
> Project stage: functional local prototype
> Current branch: fix/handle-missing-visual-collection
> For installation and usage, start with the [README](README.md)

## Summary

EKIP connects a React frontend, Express backend, PostgreSQL database, FastAPI AI
service, Qdrant vector database, and Ollama local model. The main user journey
is implemented: sign up, authenticate, upload supported documents, index them
with access metadata, ask questions, and review cited answers.

This status report summarizes repository implementation. It is not a
production-readiness assessment or a claim that every test suite has been run
successfully on every machine.

## Component status

| Component | Status | Implemented scope |
| --- | --- | --- |
| Frontend (`apps/frontend`) | Implemented | React/Vite pages for signup, login, search, upload, workspace settings, user management, and integrations |
| Backend (`apps/backend`) | Implemented | Express APIs, Prisma/PostgreSQL, authentication, role-based access, administration, documents, AI proxy, Google Drive integration |
| Text AI (`apps/ai-service`) | Implemented | Parsing, OCR fallback, chunking, embeddings, access-filtered retrieval, reranking, local generation, citations |
| Visual AI (`apps/ai-service-visual`) | Optional | ColPali page indexing and Qwen2-VL visual Q&A; requires additional compute and is enabled in the Compose `ai` profile |
| PostgreSQL | Integrated | Accounts, organization/workspace data, document metadata, refresh tokens, and answer history |
| Qdrant | Integrated | Text and visual vector collections |
| Ollama | Integrated | Local `llama3.2:3b` text generation |
| Docker Compose | Configured | Application services, PostgreSQL, Qdrant, Ollama, persistent volumes, and health checks |
| CI | Configured | GitHub Actions workflow for lint/build and selected AI tests |

## Main user flows

1. **Signup and authentication:** the first user creates an organization,
   workspace, department, and an immutable Owner account. The Owner role is
   permanent and cannot be changed, transferred, or deleted. Login and refresh
   use JWT access tokens and rotating refresh tokens.
2. **Document ingestion:** the backend stores document metadata and forwards
   content to the AI service. The service detects supported file types, parses
   content, chunks by page, generates embeddings, and writes payloads with
   access-control fields to Qdrant.
3. **Question answering:** the backend derives organization/workspace/
   department/role context from the verified token. The AI service filters
   before returning retrieval results, combines dense and sparse retrieval,
   reranks passages, calls Ollama, and returns citations.
4. **History and preview:** answer history is per user. Retained PDF originals
   can be previewed at cited pages.
5. **Administration and integrations:** Members whose role grants the relevant
   permissions have workspace and user management endpoints and pages. The Owner
   creates and assigns custom roles that define what each role can do (search,
   upload, delete documents, manage document access, connect/import Drive,
   manage users, manage roles, manage workspace/departments, view analytics).
   Google Drive import is available to roles with Drive permissions, subject to
   OAuth setup; you can import individual files or whole folders and choose
   which roles can search each file.

## Quality and operational notes

- AI unit and integration tests are under `apps/ai-service/tests`. Several
  integration-style tests need Qdrant and/or Ollama; use the documented
  commands and test requirements in the [AI Handbook](docs/08_AI_Handbook.md).
- Backend tests are under `apps/backend/tests`. The frontend provides build
  and lint scripts. CI runs selected checks; local tests may require service
  dependencies and configuration.
- The full Docker Compose `ai` profile requests NVIDIA GPU resources for the
  visual service. Hardware and Docker runtime support vary by host.
- The visual models are large; memory, storage, and startup time requirements
  are substantially higher than for the text-only path.
- `.env` files contain private configuration and must not be committed.

Recent merged work added the AI unit tests (PR #125; issue #76) and RBAC
leakage integration tests (PR #126; issue #77). Both issues are closed.

## Remaining work

Priorities for future development:

1. Expand automated coverage across backend, frontend, ingestion, and
   authorization boundaries.
2. Add retrieval and answer-quality evaluation with repeatable datasets and
   measured acceptance criteria.
3. Improve operational readiness: structured logs, metrics, backups, restore
   procedures, deployment guidance, and production secrets management.
4. Exercise tenant and role isolation with realistic integration tests.
5. Review visual processing resource requirements and make optional hardware
   behavior straightforward to configure.
6. Continue UX improvements for document role selection and user lifecycle
   management.

## Related documentation

- [README and setup](README.md)
- [Architecture](docs/05_System_Architecture.md)
- [Backend details](docs/06_Backend_Handbook.md)
- [AI pipeline](docs/08_AI_Handbook.md)
- [Deployment](docs/10_Deployment_Handbook.md)
- [Roadmap](docs/11_Project_Roadmap.md)