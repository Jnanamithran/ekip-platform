# Project Roadmap

This roadmap distinguishes capabilities already present in the repository
from work that remains. “Implemented” means code is present; it does not by
itself mean the feature has production-level reliability or complete automated
coverage.

## Core application and RAG — implemented

- [x] React frontend and Express API
- [x] Organization signup, authentication, roles, and refresh tokens
- [x] PostgreSQL schema and Prisma migrations
- [x] PDF, DOCX, XLSX, and TXT ingestion
- [x] Page-aware chunking and dense text embeddings
- [x] Qdrant indexing and access metadata
- [x] Sparse BM25 and hybrid retrieval
- [x] Cross-encoder reranking
- [x] Ollama text generation and citation extraction
- [x] User answer history and retained-PDF preview support
- [x] Docker Compose development environment

## Administration and integrations — implemented, continue improving

- [x] Workspace and department administration APIs
- [x] User lifecycle APIs
- [x] Workspace settings and user pages
- [x] Google Drive OAuth and file-import API/UI
- [x] Query analytics endpoint
- [ ] Expand frontend controls and document-role selection where needed
- [ ] Improve integration error handling and end-user guidance

## Visual document understanding — optional implementation

- [x] ColPali page embeddings
- [x] Qwen2-VL visual question answering
- [x] Visual service registered in the Docker Compose `ai` profile
- [x] Scanned-PDF forwarding from the text ingestion flow
- [ ] Validate supported hardware, runtime, memory, and timeout configurations
- [ ] Add durable visual-pipeline integration and quality tests

## Reliability and production readiness — future work

- [ ] Broaden backend, frontend, and AI integration test coverage
- [ ] Add a repeatable retrieval and answer-quality evaluation benchmark
- [ ] Test tenant and role isolation against realistic multi-tenant scenarios
- [ ] Document deployment, secrets management, backup, and restore for a chosen
  production environment
- [ ] Add structured logging, metrics, and operational alerting
- [ ] Review security controls and operational limits before production use
- [ ] Improve graceful startup and text-only configuration when GPU resources
  are unavailable

## How to contribute

Use the [README](../README.md) for setup. Update the relevant handbook when
changing behavior, and include test evidence and a `Closes #<number>` issue
reference in pull requests when applicable.
