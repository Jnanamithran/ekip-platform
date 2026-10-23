# EKIP Project Progress

> Last reviewed: 2026-10-23
> Project stage: functional local development prototype
> Current branch at review: `feature/auto-load-env-local-guide`
> For setup and usage, start with the [README](README.md).

## Overview

EKIP is a local-first document workspace with a React frontend, Express and
Prisma backend, PostgreSQL, a FastAPI text AI service, Qdrant, and Ollama. The
repository contains an end-to-end path for managing users and documents,
indexing document content, searching authorized content, and returning answers
with citations.

This report describes capabilities visible in the repository as of the review
date. Code being present does not establish that every feature has been
validated in a live deployment. EKIP remains a development prototype, not a
production-hardened service.

## Current implementation

| Area | Status | Implemented scope |
| --- | --- | --- |
| Frontend (`apps/frontend`) | Implemented | React/Vite sign-up and login, account settings, search and answer history, upload, document previews, workspace and department management, user and role management, analytics, and Google Drive integration screens. |
| Backend (`apps/backend`) | Implemented | Express APIs, Prisma/PostgreSQL access, authentication, permission checks, user and workspace administration, department and role management, document operations, AI-service proxy, analytics, and Google Drive integration. |
| Text AI (`apps/ai-service`) | Implemented | PDF, DOCX, XLSX, and TXT parsing; scanned-PDF OCR fallback; page-aware chunking; embeddings; Qdrant indexing; access-filtered dense and sparse retrieval; hybrid ranking; reranking; Ollama generation; citation extraction; and document preview support. |
| Visual AI (`apps/ai-service-visual`) | Optional implementation | ColPali page embeddings and Qwen2-VL question answering for scanned pages. The service is included in the Docker Compose `ai` profile and needs additional model resources and compatible GPU support. |
| PostgreSQL and Prisma | Integrated | Organization, workspace, department, user, role, document, document-role access, refresh-token, integration-token, answer-history, and request-progress data models, with migrations. |
| Qdrant | Integrated | Vector storage and retrieval for text and visual document content. |
| Ollama | Integrated | Local text generation using the configured `llama3.2:3b` model. |
| Local development and Compose | Configured | Local run instructions and Docker Compose services, health checks, and persistent volumes are documented. |
| Continuous integration | Configured | GitHub Actions runs frontend lint/build, a backend lint step, AI-service lint, and a selected set of AI tests. See [CI workflow](.github/workflows/ci.yml). |

## Implemented user flows

1. **Organization setup and authentication:** sign-up creates the initial
   organization, workspace, department, and Owner account. The backend
   authenticates requests and loads role permissions from the database.
   Access and refresh tokens, password controls, login protection, and account
   activation/deactivation are represented in the implementation.
2. **Workspace administration:** authorized users can manage workspace
   settings, departments, users, and custom roles. Department operations
   include validation and safeguards for default or in-use departments.
3. **Document ingestion:** users with upload permission can submit PDF, DOCX,
   XLSX, or TXT files. The backend forwards files for processing; the AI
   service extracts content, chunks it, creates embeddings, and indexes it
   with organization, workspace, department, and role access metadata.
4. **Question answering:** the backend derives authorization context from the
   authenticated user. The AI service filters document retrieval by that
   context, combines dense and sparse search, reranks passages, generates an
   answer with Ollama, and returns citations.
5. **History and source review:** answer history is associated with the
   requesting user. The application provides text citations and PDF/page
   preview support when the source original is retained.
6. **Google Drive:** users with the required permissions can connect Drive and
   import individual files or folders. Imported files use EKIP role-based
   access selection; Drive's existing sharing permissions are not preserved.
7. **Optional visual processing:** scanned documents can use the separate
   visual pipeline where its service, models, and hardware are available.

## Authorization and product boundaries

- Roles are organization-defined and consist of named permissions; backend
  routes enforce those permissions independently of frontend navigation.
- Document access is scoped using organization, workspace, department, and
  allowed-role metadata. Department grants are constrained to the user's
  workspace; they do not provide access to another workspace.
- The Owner account and Owner permissions receive special handling in the
  backend and are intended to be immutable.
- Supported upload formats are PDF, DOCX, XLSX, and TXT. PPTX and CSV are not
  supported.
- Text search and answer generation use local services in the documented
  development setup. The visual pipeline is optional and has significantly
  higher resource requirements.

## Testing and verification status

The repository includes backend tests for authentication, department
management, and Google Drive integration behavior. AI tests cover selected
endpoint behavior, parsing, chunking, citations, generation grounding,
retrieval authorization, OCR behavior, and RBAC isolation.

The configured CI checks are narrower than the full test inventory:

- Frontend lint and production build.
- A backend lint command that is configured to skip when no lint script is
  available; the current backend `package.json` does not define a lint script.
- AI-service flake8 checks on service code.
- Four explicitly selected AI pytest files: ask endpoint, citation extractor,
  ingest endpoint, and PDF parser OCR. This is not the entire AI test suite.

Some AI tests or demo-style files require live Qdrant/Ollama services or
additional setup. Consult the [README test instructions](README.md#tests-and-checks)
and [AI Handbook](docs/08_AI_Handbook.md) before running the broader suite.
This progress update was based on repository inspection; no test results are
claimed here.

## Known limitations and remaining work

1. **Production operations:** production deployment guidance for a chosen
   environment, structured operational logging, metrics, alerting, and
   tested backup/restore procedures remain incomplete.
2. **Test depth:** expand backend, frontend, and AI integration coverage,
   especially realistic multi-tenant and role/department isolation scenarios.
   Add repeatable retrieval and answer-quality evaluations with measurable
   acceptance criteria.
3. **Visual pipeline:** validate supported GPU/runtime configurations,
   resource use, timeouts, and failure behavior; add durable integration and
   quality tests. Text-only startup and use should remain straightforward
   when GPU resources are unavailable.
4. **Integration and UX:** continue improving Google Drive error handling,
   guidance, and document access selection and user lifecycle workflows.
5. **Security and operations:** review security controls and operational
   limits before production use. Keep secrets out of source control and use
   the setup guidance for local configuration.

For setup, known limitations, and service requirements, see the [README](README.md).
Related references: [system architecture](docs/05_System_Architecture.md),
[backend handbook](docs/06_Backend_Handbook.md),
[AI handbook](docs/08_AI_Handbook.md),
[deployment handbook](docs/10_Deployment_Handbook.md), and
[project roadmap](docs/11_Project_Roadmap.md).
