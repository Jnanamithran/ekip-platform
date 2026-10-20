# Project Handbook

## Purpose

EKIP is a local-first knowledge platform for organizing company documents and
answering questions from content a signed-in user is permitted to see. The
project combines a browser application, API, relational database, vector
search, and local language models.

The current deliverable is a working prototype for local development and
evaluation. It is not a claim of production readiness.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/frontend` | React/Vite user interface |
| `apps/backend` | Express APIs, authentication, Prisma models, integrations |
| `apps/ai-service` | Text document ingestion and RAG API |
| `apps/ai-service-visual` | Optional scanned-page indexing and visual QA |
| `docs` | Architecture, service handbooks, deployment notes, roadmap |
| `docker-compose.yml` | Local multi-service development stack |

## User capabilities

- Create an organization and its first workspace, department, and Admin
  account.
- Sign in, upload supported documents, and ask questions with citations.
- View retained PDF originals at cited pages when available.
- Review workspace settings, users, and integrations according to role.
- Import supported Google Drive files through the authorized integration flow.

Roles currently defined in the backend are `Admin`, `Manager`, `Employee`, and
`Intern`. Authorization is enforced at the backend and retrieval layers, not
only by hiding controls in the frontend.

## Local development

The simplest full-stack setup is Docker Compose. To run application code
directly on Windows, install PostgreSQL, Qdrant, and Ollama locally and start
the backend, AI service, and frontend in separate terminals. Follow the
step-by-step [README](../README.md).

## Development conventions

- Branch names should describe the work and use an area prefix when useful
  (`backend/`, `frontend/`, `ai/`, `docs/`, `test/`, `devops/`).
- Use commit subjects in `type(scope): summary` form, for example
  `fix(backend): validate workspace access`.
- Keep authorization checks server-side and derive identity and tenant context
  from verified credentials.
- Do not commit secrets, private `.env` files, uploads, generated model data,
  or local databases.
- Update the README or relevant handbook when a command, endpoint, or system
  behavior changes.
- Pull requests should state related issues with `Closes #<number>` when the
  change completes an issue. Follow the repository pull request template.

## Further reading

- [System architecture](05_System_Architecture.md)
- [Backend handbook](06_Backend_Handbook.md)
- [AI handbook](08_AI_Handbook.md)
- [Deployment handbook](10_Deployment_Handbook.md)
- [Roadmap](11_Project_Roadmap.md)
