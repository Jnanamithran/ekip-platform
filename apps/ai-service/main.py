import os
import tempfile
import uuid
import httpx
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from pydantic import ValidationError
from typing import Optional

from retrieval.schema import RBACContext
from retrieval.service import hybrid_retrieve
from reranking.reranker import rerank
from generation.generator import generate_answer
from citations.extractor import extract_citations
from ingestion.service import ingest_document
from chunking.service import chunk_document

app = FastAPI(title='EKIP AI Service', version='0.1.0')


@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'ekip-ai', 'version': '0.2.0'}


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class RBACInfo(BaseModel):
    org_id: str
    workspace_id: str
    department_id: str
    role: str


class AskRequest(BaseModel):
    query: str
    rbac: RBACInfo
    token: Optional[str] = None
    request_id: str


class CitationOut(BaseModel):
    id: str
    filename: str
    page: int
    excerpt: str


class AskResponse(BaseModel):
    answer: str
    sources: list[CitationOut]
    model: str
    has_answer: bool


async def report_progress(token: str, endpoint: str, **details):
    backend_url = os.getenv('BACKEND_URL', 'http://localhost:5000').rstrip('/')
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            f'{backend_url}{endpoint}',
            json=details,
            headers={'Authorization': f'Bearer {token}'},
        )
        response.raise_for_status()


def report_progress_sync(token: str, endpoint: str, **details):
    backend_url = os.getenv('BACKEND_URL', 'http://localhost:5000').rstrip('/')
    with httpx.Client(timeout=10) as client:
        response = client.post(
            f'{backend_url}{endpoint}',
            json=details,
            headers={'Authorization': f'Bearer {token}'},
        )
        response.raise_for_status()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post('/ask', response_model=AskResponse)
async def ask(req: AskRequest):
    '''
    Full RAG pipeline for one query:

      hybrid_retrieve  ->  rerank  ->  generate_answer  ->  extract_citations

    RBAC context is injected by the backend from the verified JWT token.
    The token is also forwarded so the AI service can log who asked what.
    '''
    # Normalize the incoming RBAC shape into the retrieval-layer contract
    rbac = RBACContext(
        org_id        = req.rbac.org_id,
        workspace_id  = req.rbac.workspace_id,
        department_id = req.rbac.department_id,
        role          = req.rbac.role,
    )

    if not req.token:
        raise HTTPException(status_code=401, detail='Authentication token is required')

    async def update_search(stage: str):
        await report_progress(
            req.token,
            '/ai/ask/progress',
            request_id=req.request_id,
            stage=stage,
        )

    # --- Step 6: hybrid retrieval (dense + sparse + RRF fusion) ---
    await update_search('Searching your authorized documents')
    chunks = hybrid_retrieve(query=req.query, rbac=rbac, top_k=20)

    # --- Step 7: cross-encoder rerank ---
    await update_search(f'Ranking {len(chunks)} relevant passages')
    reranked = rerank(query=req.query, chunks=chunks, top_n=5)

    # --- Step 8: Ollama LLM generation ---
    await update_search('Drafting an answer from the selected passages')
    generation_result = generate_answer(
        query=req.query,
        chunks=reranked,
    )

    # --- Step 9: citation extraction ---
    await update_search('Checking the answer and its source citations')
    cited = extract_citations(generation_result, req.query)

    # Map citations to the frontend shape (AnswerResult.jsx / CitationTab.jsx)
    sources = [
        {
            'id': c.chunk_id,
            'filename': c.filename,
            'page': c.page_num,
            'excerpt': c.chunk_text,
        }
        for c in cited.citations
    ]

    return AskResponse(
        answer=cited.answer,
        sources=sources,
        model=cited.model,
        has_answer=cited.has_answer,
    )


@app.post('/ingest')
async def ingest(
    rbac: str = Form(...),
    document_id: str = Form(...),
    token: str = Form(...),
    file: UploadFile = File(...),
):
    '''
    Document ingestion pipeline:

      ingest_document  ->  chunk_document  ->  embed_and_upsert

    The file is parsed, chunked, embedded, and upserted into Qdrant with the
    user's RBAC metadata attached. Once this call returns, the document is
    immediately searchable via /ask.
    '''
    try:
        rbac_info = RBACInfo.model_validate_json(rbac)
        document_id = str(uuid.UUID(document_id))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail='Invalid RBAC metadata') from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail='Invalid document ID') from exc

    filename = os.path.basename((file.filename or 'upload').replace('\\', '/'))

    try:
        async def update_document(stage: str, progress: int, chunk_count=None):
            details = {'stage': stage, 'progress': progress}
            if chunk_count is not None:
                details['chunk_count'] = chunk_count
            await report_progress(
                token,
                f'/ai/documents/{document_id}/progress',
                **details,
            )

        await update_document('Saving uploaded file', 10)
        with tempfile.TemporaryDirectory() as temp_dir:
            file_path = Path(temp_dir) / f'{uuid.uuid4()}{Path(filename).suffix}'
            file_path.write_bytes(await file.read())

            # --- Step 1: parse the uploaded file into pages ---
            await update_document('Parsing document pages', 20)
            ingest_result = ingest_document(str(file_path), filename=filename)
            await update_document(
                f'Parsed {len(ingest_result.pages)} page(s)',
                35,
            )

            # --- Steps 2-3: chunk + embed + upsert into Qdrant with RBAC ---
            from embeddings.service import embed_and_upsert
            from embeddings.rbac_schema import RBACMetadata

            rbac_metadata = RBACMetadata(
                org_id       = rbac_info.org_id,
                workspace_id = rbac_info.workspace_id,
                department_id = rbac_info.department_id,
                role         = rbac_info.role,
                allowed_roles = [rbac_info.role],
                uploaded_by  = 'user-' + str(uuid.uuid4())[:8],
            )

            await update_document('Splitting pages into searchable chunks', 45)
            chunks = chunk_document(ingest_result, document_id=document_id)
            await update_document(
                f'Created {len(chunks)} chunk(s)',
                60,
                chunk_count=len(chunks),
            )
            await update_document(
                f'Generating embeddings for {len(chunks)} chunk(s)',
                70,
                chunk_count=len(chunks),
            )
            embed_and_upsert(
                chunks,
                rbac_metadata,
                progress_callback=lambda stage: report_progress_sync(
                    token,
                    f'/ai/documents/{document_id}/progress',
                    stage=stage,
                    progress=90,
                    chunk_count=len(chunks),
                ),
            )

            return {
                'message': 'Document processed successfully',
                'document_id': document_id,
                'filename': ingest_result.filename,
                'chunk_count': len(chunks),
                'status': 'Indexed',
            }
    except Exception as exc:
        print(f'[ai-service] ingest error: {exc}')
        raise HTTPException(status_code=500, detail=str(exc))
