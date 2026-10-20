# AI Handbook

> Owner: AI Lead (Jnani)
>
> Covers both FastAPI AI services: the text RAG pipeline (`apps/ai-service`,
> port 8000) and the visual document pipeline (`apps/ai-service-visual`, port 8001).

Stack: Python 3.11, FastAPI, Sentence Transformers, Qdrant, `rank-bm25`, Ollama.

---

## Services at a glance

| Service | Port | Responsibility |
|---|---|---|
| `apps/ai-service` | 8000 | Ingestion, chunking, embeddings, hybrid retrieval, reranking, generation, citations |
| `apps/ai-service-visual` | 8001 | ColPali page embedding and Qwen2-VL visual question answering |

The text service calls the visual service over HTTP (`VISUAL_SERVICE_URL`).
Both services are in `docker-compose.yml` under the `ai` profile: the visual
service has its own Dockerfile, reserves one NVIDIA GPU, and shares the
`document_uploads` volume with the backend so the rendered page images can be
streamed back by the backend's page-image endpoint.

---

## Pipeline Overview

The text pipeline has nine steps. Each step is one module; the docstrings in
the source carry the detailed rationale.

| # | Step | Module | What happens |
|---|---|---|---|
| 1 | Document ingestion | `ingestion/` | Detect file type, parse into pages, OCR scanned pages |
| 2 | Chunking | `chunking/` | Sliding window per page, 200 words with 40 words of overlap |
| 3 | Dense embeddings | `embeddings/embedder.py` | `all-MiniLM-L6-v2`, 384-dim vectors, upserted to Qdrant |
| 4 | Sparse retrieval | `retrieval/sparse_search.py` | BM25 over the authorized chunk set, rebuilt per query |
| 5 | RBAC metadata filter | `retrieval/rbac_filter.py` | Metadata-only Qdrant scroll; unauthorized chunks never leave Qdrant |
| 6 | Hybrid retrieval (RRF) | `retrieval/hybrid_search.py` | Fuse dense and sparse ranked lists with Reciprocal Rank Fusion |
| 7 | Reranking | `reranking/reranker.py` | Cross-encoder rescoring of the fused candidates |
| 8 | LLM generation | `generation/generator.py` | Ollama `llama3.2:3b` answers from the reranked context only |
| 9 | Citation post-processing | `citations/extractor.py` | Parse `[SOURCE N]` markers back to document, filename and page |

Ingestion (steps 1-3) and answering (steps 4-9) are separate entry points:
`POST /ingest` and `POST /ask` respectively.

### End-to-end request flow

```text
Browser
  └── React frontend ────────────── http://localhost:5173
       └── Express backend ─────── http://localhost:5000
            │  injects RBAC from the verified JWT
            └── FastAPI AI ─────── http://localhost:8000
                 ├── Qdrant ────── chunk vectors and RBAC payload
                 ├── Ollama ────── local llama3.2:3b
                 └── Visual AI ─── http://ai-service-visual:8001
                      └── Qdrant ── page vectors (ekip_visual_documents)
```

On `/ask` the AI service first calls `has_visual_docs()`, a metadata-only scroll
over the visual collection with the caller's RBAC filter. If any accessible
visual page exists, the text and visual pipelines run in parallel via
`asyncio.gather` and their citations are merged; the answer comes from
whichever pipeline produced more citations. Otherwise only the text pipeline
runs. When the visual collection does not exist yet (no scanned document has
ever been ingested), `has_visual_docs()` treats that as "no visual documents"
and returns `False`.

---

## Models Used

| Model | Where | Size | Why this one |
|---|---|---|---|
| `all-MiniLM-L6-v2` | `embeddings/embedder.py` | 384-dim output | Small enough to leave VRAM headroom for the reranker and Ollama, which share the GPU with it |
| `cross-encoder/ms-marco-MiniLM-L-6-v2` | `reranking/reranker.py` | 6 layers, `max_length=512` | Trained on MS MARCO passage ranking; fast enough for real-time CPU or GPU use. Scores are raw logits, not 0-1 |
| `llama3.2:3b` (Ollama) | `generation/generator.py` | 3B | Runs fully locally. No hosted LLM API is contacted at query time |
| `vidore/colpali-v1.2` | `ai-service-visual/visual/colpali_embedder.py` | 128-dim output | Embeds a rendered page as one vector, capturing layout, charts and tables together. Loaded in `bfloat16` |
| `Qwen/Qwen2-VL-7B-Instruct` | `ai-service-visual/visual/qwen_generator.py` | 7B, 4-bit | Answers questions from retrieved page images. 4-bit via `bitsandbytes`, falling back to `float16` if unavailable |

---

## RBAC Enforcement

This is the platform's core security rule: **authorization happens before
retrieval**. Unauthorized chunks never reach the reranker, the LLM, or the
answer. RBAC is not a filter bolted on afterwards.

### Write-time side: metadata attached at embed time

`embeddings/rbac_schema.py` defines `RBACMetadata`, which is attached to every
point when it is upserted. There is no "add RBAC later" path.

| Payload field | Meaning |
|---|---|
| `org_id` | Owning organization |
| `workspace_id` | Owning workspace |
| `department_id` | Owning department |
| `allowed_roles` | Roles permitted to retrieve this chunk, e.g. `["Admin", "Manager"]` |
| `uploaded_by` | Uploader's user id, for the audit trail |

The same payload also carries the citation fields `document_id`, `filename`,
`file_type`, `page_num`, `chunk_index` and `text`.

### Query-time side: the filter

`retrieval/schema.py` defines `RBACContext`, the query-time counterpart. The
requester's role set is matched against each chunk's `allowed_roles`.

`retrieval/rbac_filter.py` applies the filter as a **metadata-only** Qdrant
scroll - no vector search, `with_vectors=False`. Both the sparse (BM25) and
dense paths call this one function, so there is a single definition of
"authorized" and the two paths cannot drift apart.

The filter requires all four conditions to hold:

```python
org_id        == rbac.org_id
workspace_id  == rbac.workspace_id
department_id == rbac.department_id
allowed_roles overlaps rbac.allowed_roles
```

`MAX_AUTHORIZED_CHUNKS = 5000` is a safety ceiling on the scroll, so a
pathologically large workspace cannot stall a query.

### Why BM25 is rebuilt per query

The BM25 index is deliberately not persisted. A fresh index is built in
memory, per query, from **only** the chunks `fetch_authorized_chunks()`
already returned. BM25 therefore never scores against unauthorized content,
not even internally. The trade-off is latency: at the project's realistic
scale (a few thousand chunks per workspace) rebuilding is milliseconds.

### Where RBAC is enforced outside the AI service

- **Backend.** `authenticate` verifies the JWT and attaches the five token
  fields. `requireRole(...roles)` gates whole routers. All `/admin` routes
  use both.
- **Postgres.** Document listing, preview, and deletion all filter on
  `department_id` and `allowed_roles: { has: req.user.role }`.
- **Qdrant.** The backend deletes a document's points with the same five
  conditions it used to read them.

---

## Qdrant Collection Schema

Two collections exist. The text one is created lazily by `ensure_collection()`
on the first upsert; the visual one is created by the visual service.

### `ekip_documents` (text pipeline)

| Setting | Value |
|---|---|
| Vector size | 384 |
| Distance | Cosine |
| Created by | `embeddings/qdrant_client.py` → `ensure_collection()` |

Payload indexes, all `KEYWORD`:

| Field | Indexed | Why |
|---|---|---|
| `org_id` | yes | RBAC filter, runs on every query |
| `workspace_id` | yes | RBAC filter |
| `department_id` | yes | RBAC filter |
| `allowed_roles` | yes | RBAC filter |
| `document_id` | yes | Delete-by-document and citation lookup |

Indexing these explicitly is not optional. Qdrant can filter without an
index, but it falls back to a full scan as the collection grows. Because the
RBAC filter runs on **every single query**, the filter fields must be indexed
rather than scanned.

### `ekip_visual_documents` (visual pipeline)

| Setting | Value |
|---|---|
| Vector size | 128 (ColPali late-interaction mean-pooled output) |
| Distance | Cosine |
| Created by | `ai-service-visual/visual/colpali_embedder.py` → `ensure_visual_collection()` |

Same RBAC payload indexes, plus per-page fields `image_path` and `pipeline`
(`"visual"`). Rendered page images are also written to disk under
`VISUAL_STORAGE` (default `uploads/visual`) as `<document_id>_page<N>.jpg`.

> **The text service never creates `ekip_visual_documents`.** Only the visual
> service does, on the first scanned-PDF ingest. Until then the collection does
> not exist, and `has_visual_docs()` treats that as "no visual documents".

---

## Prompt Templates

### Text pipeline (`generation/generator.py`)

The prompt is built by `_build_prompt(query, chunks)`. Each context chunk is
prefixed with `[SOURCE N | filename | page P]`, so the model can cite sources
inline and step 9 can map them back to a document and page.

```text
You are an enterprise knowledge assistant. Your job is to answer the user's question accurately and concisely using ONLY the information provided in the context below.

Rules you must follow:
- Answer using ONLY the context provided. Do not use outside knowledge.
- If the context does not contain enough information to answer, say: "I could not find a clear answer in the available documents."
- Keep your answer concise and factual — 3 sentences maximum.
- When you use information from a source, reference it as [SOURCE N] inline in your answer.
- Do not make up facts, figures, or details not present in the context.

CONTEXT:
[context block: one "[SOURCE N | filename | page P]" block per chunk]

QUESTION:
{query}

ANSWER:
```

The three grounding rules that matter:

1. **Context only.** The model must not answer from its training data.
2. **Explicit abstention.** If the context is insufficient the model is told to
   say so, rather than guess. `citations/extractor.py` then detects the
   abstention and sets `has_answer` to `False`.
3. **Inline source markers.** `[SOURCE N]` is the contract between step 8 and
   step 9.

Generation parameters: `temperature=0.1` (near-deterministic - enterprise Q&A
must be consistent, not creative), `num_predict=256`, and at most
`MAX_CONTEXT_CHUNKS = 4` chunks in the prompt.

If there are no chunks at all, the service returns
`"No relevant documents were found for your query."` without calling Ollama.

### Visual pipeline (`ai-service-visual/visual/qwen_generator.py`)

The visual prompt receives the retrieved page **images** rather than text:

```text
You are an enterprise knowledge assistant. Answer the following question using ONLY the provided document pages. Be specific and cite which page your answer comes from. If the answer is not visible in any of the pages, say clearly: 'I could not find this information in the provided pages.'

Question: {question}
```

Generation uses `max_new_tokens=512`, `temperature=0.1`, `do_sample=False`. The
processor is configured with `min_pixels=256*28*28` and
`max_pixels=1280*28*28` to bound image token usage.

---

## Ingestion and Chunking

### Supported formats

| Format | Parser | Extraction |
|---|---|---|
| PDF | `ingestion/parsers/pdf_parser.py` | Text per page via PyMuPDF, with an EasyOCR fallback |
| DOCX | `ingestion/parsers/docx_parser.py` | Word paragraphs and tables |
| XLSX | `ingestion/parsers/xlsx_parser.py` | Spreadsheet content |
| TXT | `ingestion/parsers/txt_parser.py` | Plain text |

PPTX and CSV are not supported.

`ingestion/detector.py` checks the extension **and** the magic bytes, so a
renamed or corrupted file cannot silently reach the wrong parser. PDFs must
start with `%PDF`; DOCX and XLSX must be zip containers (`PK\x03\x04`).

### OCR fallback for scanned PDFs

When a page yields fewer than `SCANNED_DOC_CHAR_THRESHOLD` (20) characters,
the parser renders the page at 200 DPI and runs EasyOCR on it. The OCR text
replaces the empty text only if it also exceeds the threshold. Any OCR failure
is swallowed and the page keeps its original empty text, so OCR can never
break ingestion.

A document is flagged `is_scanned_or_empty` when the *average* characters per
page is still below 20 after the OCR attempt. Flagged documents produce zero
chunks, and the ingestion result carries a warning naming ColPali as the
intended destination.

The EasyOCR reader is a lazy singleton - it loads ~100MB of weights once and
is reused across pages and documents.

### Chunking

`chunking/sliding_window.py` splits on **word count**, not characters, because
word count tracks token count far more reliably across content types.

| Setting | Value | Reason |
|---|---|---|
| `DEFAULT_CHUNK_SIZE_WORDS` | 200 | ~260-300 tokens, safely under the ~384-token limit of the embedding model |
| `DEFAULT_OVERLAP_WORDS` | 40 | 20% overlap keeps context continuous across chunk edges |

Chunks never cross a page or row boundary. A page already shorter than the
chunk size is kept as a single chunk untouched rather than being padded or
merged with a neighbour.

Each `Chunk` carries `chunk_id` (UUID), `document_id`, `filename`, `file_type`,
`page_num`, `chunk_index`, `text`, `word_count` and `char_count`.

---

## HTTP API

### Text service (`apps/ai-service`, port 8000)

**GET /health**
- 200: `{ "status": "ok", "service": "ekip-ai", "version": "0.2.0" }`

**POST /ask**
- Body: `{ "query", "rbac": { "org_id", "workspace_id", "department_id", "role", "allowed_roles"? }, "token", "request_id" }`
- `allowed_roles` is optional and defaults to `[role]`. Roles are validated
  against `Admin`, `Owner`, `Manager`, `Employee`, `Intern`.
- 200: `{ "answer", "sources": [{ "id", "document_id", "filename", "page", "excerpt" }], "model", "has_answer", "pipeline" }`
- `pipeline` is `"text"`, `"visual"`, or `"hybrid"`.
- 401: `token` missing
- 422: invalid body

**POST /ingest** (multipart/form-data)
- Fields: `rbac` (JSON string), `document_id` (UUID), `token`, `file`
- 200: `{ "message", "document_id", "filename", "chunk_count", "status": "Indexed" }`
- 422: invalid RBAC metadata or document id
- 500: parsing, chunking, or embedding failure

When the parser flags a PDF `is_scanned_or_empty`, the service also forwards
the file (multipart: `rbac` JSON string, `document_id`, `file`) to the visual
service's `POST /visual/ingest` for ColPali page indexing. The call is awaited
(timeout `VISUAL_INGEST_TIMEOUT`, default 120 s) and is **non-fatal**: if the
visual service is unreachable or returns an error, the failure is logged and
the text pipeline still completes.

Progress is reported back to the backend during ingestion at 10%, 20%, 35%,
40% (visual routing, scanned PDFs only), 45%, 60%, 70% and 90%.

### Visual service (`apps/ai-service-visual`, port 8001)

**GET /health** - 200: `{ "status": "ok", "service": "ekip-visual-ai", "version": "0.1.0" }`

**POST /visual/ingest** (multipart/form-data)
- Fields: `rbac` (JSON string), `document_id` (UUID), `file`
- 200: `{ "message", "document_id", "filename", "pages_upserted", "pipeline": "visual" }`
- 422: invalid RBAC metadata, document id, or a PDF with zero pages
- 500: rendering or embedding failure

**POST /visual/search**
- Body: `{ "query", "org_id", "workspace_id", "department_id", "role", "top_k"? }`
- 200: `{ "results": [{ "document_id", "filename", "page_num", "image_path", "score" }], "query" }`

**POST /visual/ask**
- Body: `{ "question", "org_id", "workspace_id", "department_id", "role", "top_k"? }`
- 200: `{ "answer", "citations": [{ "filename", "page_num", "text", "type", "document_id" }], "model", "pipeline" }`

**DELETE /visual/document/{document_id}**
- 200: `{ "message", "document_id", "deleted" }`

### Page-image preview (Express backend, port 5000)

**GET /ai/documents/:id/page-image/:page_num** (JWT required)
- Streams the JPEG that the visual pipeline rendered for page `page_num`
  (1-based) of document `id`. Images are written by the visual service to the
  shared `document_uploads` volume at `uploads/visual/{id}_page{N}.jpg`.
- Access is checked against the `Document` row (`department_id` +
  `allowed_roles`), the same guard as `/ai/documents/:id/preview`.
- 200: `image/jpeg`
- 400: invalid document id or page number
- 404: document not accessible, or no rendered image exists (the document was
  not processed by the visual pipeline)
- Used by the frontend to show the cited page next to visual answers.

### Progress reporting

The AI service pushes stage updates back to the backend over HTTP rather than
holding the request open:

| Caller | Backend endpoint |
|---|---|
| `/ask` | `POST /ai/ask/progress` |
| `/ingest` | `POST /ai/documents/{id}/progress` |

`BACKEND_URL` selects the target and defaults to `http://localhost:5000`. The
backend authenticates these calls with the same JWT the browser sent, and
stores them in `AiRequestProgress` / `Document.progress` so the UI can poll
for the current stage.

---

## Configuration

Copy `apps/ai-service/.env.example` to `apps/ai-service/.env` and adjust:

```dotenv
QDRANT_URL=http://localhost:6333
OLLAMA_URL=http://localhost:11434
BACKEND_URL=http://localhost:5000
VISUAL_SERVICE_URL=http://localhost:8001
VISUAL_INGEST_TIMEOUT=120
COLPALI_MODEL=vidore/colpali-v1.2
QWEN_MODEL=Qwen/Qwen2-VL-7B-Instruct
```

| Variable | Default | Used by |
|---|---|---|
| `QDRANT_URL` | `http://localhost:6333` | Text service, visual service |
| `OLLAMA_URL` | `http://localhost:11434` | Text service |
| `BACKEND_URL` | `http://localhost:5000` | Text service (progress reporting) |
| `VISUAL_SERVICE_URL` | `http://ai-service-visual:8001` | Text service (visual ingest forwarding and visual ask) |
| `VISUAL_INGEST_TIMEOUT` | `120` | Text service (seconds to wait for `/visual/ingest`) |
| `VISUAL_STORAGE` | `uploads/visual` | Visual service (page images) |
| `COLPALI_MODEL` | `vidore/colpali-v1.2` | Visual service |
| `QWEN_MODEL` | `Qwen/Qwen2-VL-7B-Instruct` | Visual service |
| `RENDER_DPI` | `150` | Visual service |

Inside Docker Compose the text service is configured with
`QDRANT_URL=http://qdrant:6333`, `OLLAMA_URL=http://ollama:11434`,
`BACKEND_URL=http://backend:5000` and
`VISUAL_SERVICE_URL=http://ai-service-visual:8001`; the visual service gets
`QDRANT_URL=http://qdrant:6333`.

---

## Running the services

### Text service

```powershell
Set-Location apps/ai-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Visual service (GPU recommended)

The visual service has a Dockerfile (`apps/ai-service-visual/Dockerfile`) and
is part of the Compose stack under the `ai` profile. It reserves one NVIDIA
GPU via `deploy.resources.reservations`:

```powershell
docker compose --profile ai up --build
```

Host prerequisites for the GPU path: Docker Compose v2, the NVIDIA Container
Toolkit, and a CUDA 12.1-capable driver. The image installs the CUDA build of
torch/torchvision separately from `requirements.txt`, because the CUDA index
is not on PyPI. Without a GPU the service still starts and ColPali falls back
to CPU, but visual ingestion is very slow.

For local development without Docker:

```powershell
Set-Location apps/ai-service-visual
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
python -m uvicorn main:app --host 0.0.0.0 --port 8001
```

Torch is installed separately because the CUDA build index is not on PyPI.

### VRAM notes

The two sentence-transformers models and Ollama share one GPU in the text
service, which is why the embedding model was kept small. The visual service
is heavier: ColPali in `bfloat16` is roughly 4.5GB, and Qwen2-VL-7B in 4-bit
is roughly 4.5GB. The two visual models do not comfortably fit together on a
6GB card, so Ollama should be stopped while the visual service is in use.

---

## Tests

```powershell
Set-Location apps/ai-service
python -m pytest tests -q
```

The suite covers the ingest and ask endpoints, the PDF parser and its OCR
fallback, the citation extractor, hybrid fusion, the reranker, and generation.

**Current status: 13 passed offline; 4 modules require the running stack.**
`test_ask_endpoint.py`, `test_citation_extractor.py`, `test_ingest_endpoint.py`
and `test_pdf_parser_ocr.py` run without any services (13 tests pass).
`test_citations.py`, `test_generation.py`, `test_hybrid.py` and
`test_reranker.py` are integration-style modules that call Qdrant at module
import time; they pass once the Compose `ai` profile stack is up, and fail
with Qdrant connection errors otherwise.

---

## Known issues and blockers

The blockers found during the documentation audit have been resolved:

| Issue | Status |
|---|---|
| `MatchValue` not imported in `retrieval/rbac_filter.py` — broke the BM25 half of every `/ask` | Fixed (PR #97) |
| Four test modules built `RBACContext(...)` without `allowed_roles`, breaking pytest collection | Fixed (PR #98) |
| `has_visual_docs()` raised `UnexpectedResponse: 404` on every `/ask` until the first scanned document existed | Now handled: a missing visual collection returns `False` |
| `POST /visual/ingest` had no caller; the visual service had no Dockerfile and no Compose entry | Wired up: `/ingest` forwards scanned PDFs and the service runs in the `ai` profile |

### Current known issues

1. **`tests/demo.py` still uses the old `RBACContext` shape.** It is not
   collected by pytest, but running it directly raises a pydantic
   `ValidationError` because `allowed_roles` is missing — the same pattern that
   PR #98 fixed in the test modules.
2. **Four test modules need the running stack.** `test_citations.py`,
   `test_generation.py`, `test_hybrid.py` and `test_reranker.py` call Qdrant at
   module import time, so they fail with connection errors unless the Compose
   `ai` profile stack is up.
3. **Large scanned PDFs can outlive the visual-ingest timeout.** The forward
   call to `/visual/ingest` uses `VISUAL_INGEST_TIMEOUT` (default 120 s). A
   timeout is non-fatal — the document is still text-indexed — but it skips
   visual indexing for that document; raise the timeout for large scans.
