# AI Handbook

This handbook covers the text RAG service (`apps/ai-service`, port 8000) and
the optional visual service (`apps/ai-service-visual`, port 8001). Both use
Qdrant. Text generation uses a local Ollama model; visual question answering
uses the visual service's model stack.

## Services and models

| Service/model | Purpose |
| --- | --- |
| FastAPI text service | Parsing, indexing, retrieval, reranking, answer generation |
| `all-MiniLM-L6-v2` | 384-dimensional text embeddings |
| `cross-encoder/ms-marco-MiniLM-L-6-v2` | Passage reranking |
| Ollama `llama3.2:3b` | Local text answer generation |
| FastAPI visual service | Scanned-page indexing and image-grounded QA |
| `vidore/colpali-v1.2` | Visual page embeddings |
| `Qwen/Qwen2-VL-7B-Instruct` | Visual question answering |

Model downloads can consume substantial disk space and memory. The visual
models have significantly higher compute requirements than the text pipeline.

## Text pipeline

### Ingestion

The text service accepts PDF, DOCX, XLSX, and TXT. The detector checks file
type signatures in addition to the filename extension. Parsers extract page
or sheet content; PDF pages with little extractable text can use EasyOCR.

Content is split into word-based chunks without crossing page boundaries.
Chunks are embedded and stored in the `ekip_documents` Qdrant collection with
citation metadata and access-control payload fields.

For scanned/image-based PDFs, the AI service can forward the file to the visual
service's `POST /visual/ingest`. Visual indexing failures are logged and do
not necessarily prevent text ingestion from completing.

### Answering

The `/ask` flow:

1. Validates the request and RBAC context supplied by the backend.
2. Retrieves only passages matching organization, workspace, department, and
   allowed roles.
3. Combines dense and BM25 sparse results using reciprocal-rank fusion.
4. Reranks candidates with a cross-encoder.
5. Builds a context-limited prompt and calls Ollama.
6. Extracts source markers into document/page citations.

The prompt directs the model to use supplied context only and to abstain when
the context is insufficient. Treat this as an application behavior, not a
guarantee that model output is always correct.

## Authorization in retrieval

Access metadata is attached to each Qdrant point during ingestion. The
retrieval service filters before returning candidate passages to ranking or
generation. The key fields are:

| Field | Meaning |
| --- | --- |
| `org_id` | Owning organization |
| `workspace_id` | Owning workspace |
| `department_id` | Owning department |
| `allowed_roles` | Roles allowed to retrieve the content |
| `uploaded_by` | Uploader identifier |

Additional fields hold the document ID, filename, file type, page, chunk index,
and text used for answer citations. The backend is responsible for deriving
the caller's identity from its verified authentication token.

## Qdrant collections

| Collection | Content | Vector size |
| --- | --- | ---: |
| `ekip_documents` | Text chunks | 384 |
| `ekip_visual_documents` | Rendered PDF pages | 128 |

Collections are created by their respective embedding services as needed.
Payload indexes support access filters and document operations. Qdrant data is
persisted by the Compose volume in the Docker setup.

## HTTP APIs

### Text service (`:8000`)

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Health response |
| `POST /ingest` | Parse, chunk, embed, and index a multipart upload |
| `POST /ask` | Retrieve authorized content and generate a cited answer |

Ingestion takes the file, document identifier, RBAC metadata, and the
forwarded user token. Ask requests include query, RBAC context, token, and
request/progress information as used by the backend.

### Visual service (`:8001`)

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Health response |
| `POST /visual/ingest` | Render and index PDF pages |
| `POST /visual/search` | Retrieve authorized visual pages |
| `POST /visual/ask` | Answer from retrieved page images |
| `DELETE /visual/document/{document_id}` | Delete a visual document |

The visual service writes page images to its configured storage directory.
Compose shares the upload volume with the backend to support authorized
page-image previews.

## Configuration

| Variable | Typical local value | Purpose |
| --- | --- | --- |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant service URL |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama service URL |
| `BACKEND_URL` | `http://localhost:5000` | Progress callback target |
| `VISUAL_SERVICE_URL` | `http://localhost:8001` | Optional visual-service URL |
| `VISUAL_INGEST_TIMEOUT` | `120` | Visual-ingestion request timeout |
| `COLPALI_MODEL` | `vidore/colpali-v1.2` | Visual embedding model |
| `QWEN_MODEL` | `Qwen/Qwen2-VL-7B-Instruct` | Visual QA model |
| `VISUAL_STORAGE` | `uploads/visual` | Rendered visual page storage |
| `RENDER_DPI` | `150` | PDF rendering resolution |

In Compose, service-to-service URLs use the Compose service names rather than
`localhost`. See the [deployment handbook](10_Deployment_Handbook.md) for
complete startup commands.

## Run the text service locally

Install Python 3.11 and start PostgreSQL (for the backend), Qdrant, and Ollama
locally. Pull the configured Ollama model. Then, from PowerShell:

```powershell
Set-Location .\apps\ai-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
$env:QDRANT_URL = "http://localhost:6333"
$env:OLLAMA_URL = "http://localhost:11434"
$env:BACKEND_URL = "http://localhost:5000"
$env:VISUAL_SERVICE_URL = "http://localhost:8001"
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The visual service is optional for text-document use. Its separate Python
dependencies, model weights, memory requirements, and hardware support should
be considered before enabling scanned-page processing.

## Tests

From `apps/ai-service` with dependencies installed:

```powershell
python -m pytest tests -q
```

Tests are in `tests/`. Some exercise unit-level behavior, while integration
tests may require Qdrant, Ollama, models, or other runtime configuration. Run
the relevant tests with their required services available; do not interpret a
service connection failure as a passing test.

## Current limitations

- Supported text upload formats are PDF, DOCX, XLSX, and TXT. PPTX and CSV are
  not supported.
- OCR and visual indexing are resource-intensive and may not finish within the
  default visual-ingest timeout on large scanned files.
- AI responses can be incomplete or incorrect. Citations should be checked
  against their source documents.
- Retrieval and answer quality need a repeatable evaluation suite before
  production use.
- Qdrant and model services are configured for local development, not
  high-availability deployment.
