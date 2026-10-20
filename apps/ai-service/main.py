import os
import tempfile
import uuid
import asyncio
import httpx
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, field_validator
from pydantic import ValidationError
from typing import List, Optional

from retrieval.schema import RBACContext
from retrieval.service import hybrid_retrieve
from reranking.reranker import rerank
from generation.generator import generate_answer
from citations.extractor import extract_citations
from ingestion.service import ingest_document
from chunking.service import chunk_document

from embeddings.qdrant_client import get_client
from qdrant_client.models import Filter, FieldCondition, MatchValue

app = FastAPI(title='EKIP AI Service', version='0.1.0')


@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'ekip-ai', 'version': '0.2.0'}


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

ALLOWED_ROLES = {"Admin", "Manager", "Employee", "Intern"}

VISUAL_COLLECTION = "ekip_visual_documents"
VISUAL_SERVICE_URL = os.getenv("VISUAL_SERVICE_URL", "http://ai-service-visual:8001")


class RBACInfo(BaseModel):
    org_id: str
    workspace_id: str
    department_id: str
    role: str
    allowed_roles: Optional[List[str]] = None   # multiple roles allowed to see uploaded chunks
    user_id: Optional[str] = None               # real uploader id, for audit trail

    @field_validator("allowed_roles", mode="after")
    @classmethod
    def _validate_allowed_roles(
        cls, value: Optional[List[str]]
    ) -> Optional[List[str]]:
        if value is None:
            return None
        seen: List[str] = []
        for r in value:
            if r not in ALLOWED_ROLES:
                raise ValueError(
                    f"Invalid role: {r!r}. Must be one of {sorted(ALLOWED_ROLES)}"
                )
            if r not in seen:
                seen.append(r)
        return seen or None


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
    """Check if this user has any visual-indexed documents in scope.

    Scrolls the visual Qdrant collection with an RBAC filter (limit=1) and
    returns True when at least one accessible visual page exists.
    """
    client = get_client()
    rbac_filter = Filter(must=[
        FieldCondition(key="org_id", match=MatchValue(value=rbac_dict["org_id"])),
        FieldCondition(key="workspace_id", match=MatchValue(value=rbac_dict["workspace_id"])),
        FieldCondition(key="department_id", match=MatchValue(value=rbac_dict["department_id"])),
        FieldCondition(key="allowed_roles", match=MatchValue(value=rbac_dict["role"])),
    ])
    result = client.scroll(
        collection_name=VISUAL_COLLECTION,
        scroll_filter=rbac_filter,
        limit=1,
        with_vectors=False,
    )
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
    await update_search('Searching your authorized documents')
    chunks = hybrid_retrieve(query=query, rbac=rbac, top_k=12)

    # --- Step 7: cross-encoder rerank ---
    await update_search(f'Ranking {len(chunks)} relevant passages')
    reranked = rerank(query=query, chunks=chunks, top_n=4)

    # --- Step 8: Ollama LLM generation ---
    await update_search('Drafting an answer from the selected passages')
    generation_result = generate_answer(
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

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f'{VISUAL_SERVICE_URL}/visual/ask',
            json={
                'question': question,
                'org_id': rbac_dict['org_id'],
                'workspace_id': rbac_dict['workspace_id'],
                'department_id': rbac_dict['department_id'],
                'role': rbac_dict['role'],
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
        }
        for c in payload.get('citations', [])
    ]

    return {
        'answer': payload.get('answer', ''),
        'sources': citations,
        'model': payload.get('model', ''),
        'has_answer': bool(payload.get('answer')),
        'pipeline': 'visual',
    }


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

    When the user's accessible documents include visual-indexed pages, the
    text and visual pipelines run in parallel and their results are merged.
    '''
    # Normalize the incoming RBAC shape into the retrieval-layer contract
    allowed_roles = req.rbac.allowed_roles or [req.rbac.role]
    rbac = RBACContext(
        org_id        = req.rbac.org_id,
        workspace_id  = req.rbac.workspace_id,
        department_id = req.rbac.department_id,
        role          = req.rbac.role,
        allowed_roles = allowed_roles,
    )

    if not req.token:
        raise HTTPException(status_code=401, detail='Authentication token is required')

    rbac_dict = {
        'org_id':        req.rbac.org_id,
        'workspace_id':  req.rbac.workspace_id,
        'department_id': req.rbac.department_id,
        'role':          req.rbac.role,
    }

    visual_available = has_visual_docs(rbac_dict)

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

            allowed_roles = rbac_info.allowed_roles or [rbac_info.role]
            rbac_metadata = RBACMetadata(
                org_id       = rbac_info.org_id,
                workspace_id = rbac_info.workspace_id,
                department_id = rbac_info.department_id,
                role         = rbac_info.role,
                allowed_roles = allowed_roles,
                uploaded_by  = rbac_info.user_id or 'user-' + str(uuid.uuid4())[:8],
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
