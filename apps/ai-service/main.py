import os
import json
import secrets
import tempfile
import uuid
import asyncio
import httpx
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel
from pydantic import ValidationError
from typing import List, Optional

from retrieval.schema import RBACContext
from retrieval.service import hybrid_retrieve
from reranking.reranker import rerank
from generation.generator import generate_answer
from citations.extractor import extract_citations
from ingestion.service import ingest_document
from ingestion.schema import FileType
from chunking.service import chunk_document

from embeddings.qdrant_client import get_client
from qdrant_client.models import Filter, FieldCondition, MatchAny, MatchValue
from qdrant_client.http.exceptions import UnexpectedResponse

app = FastAPI(title='EKIP AI Service', version='0.1.0')


@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'ekip-ai', 'version': '0.2.0'}


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

VISUAL_COLLECTION = "ekip_visual_documents"
VISUAL_SERVICE_URL = os.getenv("VISUAL_SERVICE_URL", "http://ai-service-visual:8001")
AI_SERVICE_API_KEY = os.getenv("AI_SERVICE_API_KEY", "")
VISUAL_ASK_TIMEOUT = float(os.getenv("VISUAL_ASK_TIMEOUT", "300"))


async def require_backend_service_key(x_ekip_service_key: str | None = Header(default=None)):
    if len(AI_SERVICE_API_KEY) < 32:
        raise HTTPException(status_code=503, detail='AI service authentication is not configured')
    if not x_ekip_service_key or not secrets.compare_digest(
        x_ekip_service_key,
        AI_SERVICE_API_KEY,
    ):
        raise HTTPException(status_code=401, detail='Invalid service credentials')


class RBACInfo(BaseModel):
    org_id: str
    workspace_id: str
    department_id: str
    department_ids: Optional[List[str]] = None
    role_id: str
    is_owner: bool = False
    allowed_role_ids: Optional[List[str]] = None
    user_id: Optional[str] = None               # real uploader id, for audit trail


class AskRequest(BaseModel):
    query: str
    rbac: RBACInfo
    token: Optional[str] = None
    request_id: str


class CitationOut(BaseModel):
    id: str
    document_id: str
    filename: str
    page: int
    excerpt: str
    type: str = "text"  # "text" | "visual" — visual = ColPali + Qwen2-VL page


class AskResponse(BaseModel):
    answer: str
    sources: list[CitationOut]
    model: str
    has_answer: bool
    pipeline: str = "text"   # "text" | "visual" | "hybrid"


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
# Visual-document detection + pipeline helpers
# ---------------------------------------------------------------------------

def has_visual_docs(rbac_dict: dict) -> bool:
    """Check if this user has any visual-indexed documents in scope."""
    client = get_client()
    conditions = [
        FieldCondition(key="org_id", match=MatchValue(value=rbac_dict["org_id"])),
        FieldCondition(key="workspace_id", match=MatchValue(value=rbac_dict["workspace_id"])),
    ]
    if not rbac_dict["is_owner"]:
        department_ids = rbac_dict.get("department_ids") or [rbac_dict["department_id"]]
        if not department_ids:
            return False
        conditions.extend([
            FieldCondition(
                key="allowed_role_ids",
                match=MatchValue(value=rbac_dict["role_id"]),
            ),
            FieldCondition(
                key="department_id",
                match=MatchAny(any=department_ids),
            ),
        ])
    rbac_filter = Filter(must=conditions)
    try:
        result = client.scroll(
            collection_name=VISUAL_COLLECTION,
            scroll_filter=rbac_filter,
            limit=1,
            with_vectors=False,
        )
    except UnexpectedResponse as exc:
        # The collection does not exist until the first scanned document has
        # been ingested — treat that as "no visual documents yet".
        if exc.status_code == 404:
            return False
        raise
    except ValueError:
        # Older qdrant-client versions raise ValueError for a missing collection.
        return False
    return len(result[0]) > 0


async def run_text_pipeline(query: str, rbac: RBACContext, token: str, request_id: str) -> dict:
    """Run the text RAG pipeline and return a normalized result dict."""

    async def update_search(stage: str):
        await report_progress(
            token,
            '/ai/ask/progress',
            request_id=request_id,
            stage=stage,
        )

    # --- Step 6: hybrid retrieval (dense + sparse + RRF fusion) ---
    # Runs in a thread: Qdrant network calls + embedding encode are blocking.
    await update_search('Searching your authorized documents')
    chunks = await asyncio.to_thread(
        hybrid_retrieve, query=query, rbac=rbac, top_k=12
    )

    # --- Step 7: cross-encoder rerank ---
    # CPU-bound model inference — offload so the event loop stays free.
    await update_search(f'Ranking {len(chunks)} relevant passages')
    reranked = await asyncio.to_thread(rerank, query=query, chunks=chunks, top_n=4)

    # --- Step 8: Ollama LLM generation ---
    # Ollama chat is a blocking HTTP call — run off the event loop.
    await update_search('Drafting an answer from the selected passages')
    generation_result = await asyncio.to_thread(
        generate_answer,
        query=query,
        chunks=reranked,
    )

    # --- Step 9: citation extraction ---
    await update_search('Checking the answer and its source citations')
    cited = extract_citations(generation_result, query)

    # Map citations to the frontend shape (AnswerResult.jsx / CitationTab.jsx)
    sources = [
        {
            'id': c.chunk_id,
            'document_id': c.document_id,
            'filename': c.filename,
            'page': c.page_num,
            'excerpt': c.chunk_text,
            'type': 'text',
        }
        for c in cited.citations
    ]

    return {
        'answer': cited.answer,
        'sources': sources,
        'model': cited.model,
        'has_answer': cited.has_answer,
        'pipeline': 'text',
    }


async def run_visual_pipeline(question: str, rbac_dict: dict) -> dict:
    """Ask the visual service and normalize its citations to CitationOut shape."""

    async with httpx.AsyncClient(timeout=VISUAL_ASK_TIMEOUT) as client:
        response = await client.post(
            f'{VISUAL_SERVICE_URL}/visual/ask',
            headers={'x-ekip-service-key': AI_SERVICE_API_KEY},
            json={
                'question': question,
                'org_id': rbac_dict['org_id'],
                'workspace_id': rbac_dict['workspace_id'],
                'department_id': rbac_dict['department_id'],
                'department_ids': rbac_dict.get('department_ids') or [rbac_dict['department_id']],
                'role_id': rbac_dict['role_id'],
                'is_owner': rbac_dict['is_owner'],
                'allowed_role_ids': rbac_dict.get('allowed_role_ids') or [rbac_dict['role_id']],
            },
        )
        response.raise_for_status()
        payload = response.json()

    citations = [
        {
            'id': f"visual-{c.get('document_id', 'unknown')}-{c['page_num']}",
            'document_id': c.get('document_id', 'unknown'),
            'filename': c['filename'],
            'page': c['page_num'],
            'excerpt': c['text'],
            'type': c.get('type', 'visual'),
        }
        for c in payload.get('citations', [])
    ]

    return {
        'answer': payload.get('answer', ''),
        'sources': citations,
        'model': payload.get('model', ''),
        'has_answer': bool(citations),
        'pipeline': 'visual',
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post('/ask', response_model=AskResponse)
async def ask(req: AskRequest, _service_key: None = Depends(require_backend_service_key)):
    '''
    Full RAG pipeline for one query:

      hybrid_retrieve  ->  rerank  ->  generate_answer  ->  extract_citations

    RBAC context is injected by the backend from the verified JWT token.
    The token is also forwarded so the AI service can log who asked what.

    When the user's accessible documents include visual-indexed pages, the
    text and visual pipelines run in parallel and their results are merged.
    '''
    # Normalize the incoming RBAC shape into the retrieval-layer contract
    allowed_role_ids = req.rbac.allowed_role_ids or [req.rbac.role_id]
    department_ids = req.rbac.department_ids or [req.rbac.department_id]
    rbac = RBACContext(
        org_id        = req.rbac.org_id,
        workspace_id  = req.rbac.workspace_id,
        department_id = req.rbac.department_id,
        department_ids = department_ids,
        role_id       = req.rbac.role_id,
        is_owner      = req.rbac.is_owner,
        allowed_role_ids = allowed_role_ids,
    )

    if not req.token:
        raise HTTPException(status_code=401, detail='Authentication token is required')

    rbac_dict = {
        'org_id':        req.rbac.org_id,
        'workspace_id':  req.rbac.workspace_id,
        'department_id': req.rbac.department_id,
        'department_ids': department_ids,
        'role_id':       req.rbac.role_id,
        'is_owner':      req.rbac.is_owner,
        'allowed_role_ids': allowed_role_ids,
    }

    visual_available = await asyncio.to_thread(has_visual_docs, rbac_dict)

    if visual_available:
        # Run text and visual in parallel, merge citations
        text_result, visual_result = await asyncio.gather(
            run_text_pipeline(req.query, rbac, req.token, req.request_id),
            run_visual_pipeline(req.query, rbac_dict),
        )

        # Merge citations from both pipelines
        all_citations = text_result['sources'] + visual_result['sources']

        # Use answer from pipeline with more citations (more grounded)
        primary = text_result if len(text_result['sources']) >= \
            len(visual_result['sources']) else visual_result

        return AskResponse(
            answer=primary['answer'],
            sources=all_citations,
            model=primary['model'],
            has_answer=primary['has_answer'],
            pipeline='hybrid',
        )

    # Text only (existing behavior)
    text_result = await run_text_pipeline(req.query, rbac, req.token, req.request_id)
    return AskResponse(
        answer=text_result['answer'],
        sources=text_result['sources'],
        model=text_result['model'],
        has_answer=text_result['has_answer'],
        pipeline=text_result['pipeline'],
    )


@app.post('/ingest')
async def ingest(
    _service_key: None = Depends(require_backend_service_key),
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
        visual_indexed = False

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

            # --- Step 1b: scanned/image-only PDFs are also visual-indexed ---
            if (
                ingest_result.is_scanned_or_empty
                and ingest_result.file_type == FileType.PDF
            ):
                await update_document(
                    'Routing scanned pages to the visual pipeline (ColPali)',
                    40,
                )
                visual_rbac = {
                    'org_id':        rbac_info.org_id,
                    'workspace_id':  rbac_info.workspace_id,
                    'department_id': rbac_info.department_id,
                    'allowed_role_ids': rbac_info.allowed_role_ids or [rbac_info.role_id],
                    'uploaded_by':   rbac_info.user_id
                                     or 'user-' + str(uuid.uuid4())[:8],
                }
                try:
                    # The visual service runs in its own container, so the
                    # temp file_path is not shared — forward the bytes
                    # as multipart (the /visual/ingest contract is
                    # rbac + document_id Form fields plus the file upload).
                    async with httpx.AsyncClient(
                        timeout=float(os.getenv('VISUAL_INGEST_TIMEOUT', '120')),
                    ) as visual_client:
                        visual_response = await visual_client.post(
                            f'{VISUAL_SERVICE_URL}/visual/ingest',
                            headers={'x-ekip-service-key': AI_SERVICE_API_KEY},
                            data={
                                'rbac':        json.dumps(visual_rbac),
                                'document_id': document_id,
                            },
                            files={
                                'file': (
                                    filename,
                                    file_path.read_bytes(),
                                    'application/pdf',
                                ),
                            },
                        )
                        visual_response.raise_for_status()
                        visual_indexed = visual_response.json().get('pages_upserted', 0) > 0
                except Exception as exc:
                    # Non-fatal: text indexing below still proceeds, and the
                    # document remains searchable through the text pipeline.
                    print(
                        f'[ai-service] visual ingest failed for '
                        f'{document_id}: {exc}'
                    )

            # --- Steps 2-3: chunk + embed + upsert into Qdrant with RBAC ---
            from embeddings.service import embed_and_upsert
            from embeddings.rbac_schema import RBACMetadata

            allowed_role_ids = rbac_info.allowed_role_ids or [rbac_info.role_id]
            rbac_metadata = RBACMetadata(
                org_id       = rbac_info.org_id,
                workspace_id = rbac_info.workspace_id,
                department_id = rbac_info.department_id,
                allowed_role_ids = allowed_role_ids,
                uploaded_by  = rbac_info.user_id or 'user-' + str(uuid.uuid4())[:8],
            )

            await update_document('Splitting pages into searchable chunks', 45)
            chunks = chunk_document(ingest_result, document_id=document_id)
            await update_document(
                f'Created {len(chunks)} chunk(s)',
                60,
                chunk_count=len(chunks),
            )
            if not chunks and not visual_indexed:
                raise HTTPException(
                    status_code=422,
                    detail=ingest_result.warning or 'No searchable content was extracted from this document.',
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
    except HTTPException:
        raise
    except Exception as exc:
        print(f'[ai-service] ingest error: {exc}')
        raise HTTPException(status_code=500, detail=str(exc))


@app.post('/preview')
async def preview(
    file: UploadFile = File(...),
    _service_key: None = Depends(require_backend_service_key),
):
    filename = os.path.basename((file.filename or 'upload').replace('\\', '/'))
    file_type = Path(filename).suffix.lower()
    if file_type not in {'.docx', '.xlsx', '.txt'}:
        raise HTTPException(status_code=415, detail='Preview supports DOCX, XLSX, and TXT files')

    content = await file.read(50 * 1024 * 1024 + 1)
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail='File exceeds the 50 MB preview limit')

    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            file_path = Path(temp_dir) / f'{uuid.uuid4()}{file_type}'
            file_path.write_bytes(content)
            result = ingest_document(str(file_path), filename=filename)

        return {
            'filename': result.filename,
            'file_type': result.file_type.value,
            'pages': [
                {'page_num': page.page_num, 'text': page.text}
                for page in result.pages
            ],
            'warning': result.warning,
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail='File could not be previewed') from exc
    except Exception as exc:
        print(f'[ai-service] preview error for {filename}: {exc}')
        raise HTTPException(status_code=422, detail='File could not be previewed') from exc
