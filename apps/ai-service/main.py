import os
import uuid

from fastapi import FastAPI, HTTPException, UploadFile
from pydantic import BaseModel
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


class CitationOut(BaseModel):
    source_num: int
    filename: str
    page_num: int
    chunk_text: str
    chunk_id: str
    document_id: str


class AskResponse(BaseModel):
    answer: str
    sources: list[CitationOut]
    model: str
    has_answer: bool


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

    # --- Step 6: hybrid retrieval (dense + sparse + RRF fusion) ---
    chunks = hybrid_retrieve(query=req.query, rbac=rbac, top_k=20)

    # --- Step 7: cross-encoder rerank ---
    reranked = rerank(query=req.query, chunks=chunks, top_n=5)

    # --- Step 8: Ollama LLM generation ---
    generation_result = generate_answer(
        query=req.query,
        chunks=reranked,
    )

    # --- Step 9: citation extraction ---
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
async def ingest(req: AskRequest, file: UploadFile):
    '''
    Document ingestion pipeline:

      ingest_document  ->  chunk_document  ->  embed_and_upsert

    The file is parsed, chunked, embedded, and upserted into Qdrant with the
    user's RBAC metadata attached. Once this call returns, the document is
    immediately searchable via /ask.
    '''
    try:
        # --- Step 1: parse the file into pages ---
        ingest_result = ingest_document(
            file_path=file.filename,
            filename=os.path.basename(file.filename or ''),
        )

        # --- Steps 2-3: chunk + embed + upsert into Qdrant with RBAC ---
        from embeddings.service import embed_and_upsert
        from embeddings.rbac_schema import RBACMetadata

        rbac_metadata = RBACMetadata(
            org_id       = req.rbac.org_id,
            workspace_id = req.rbac.workspace_id,
            department_id = req.rbac.department_id,
            role         = req.rbac.role,
            allowed_roles = [req.rbac.role],
            uploaded_by  = 'user-' + str(uuid.uuid4())[:8],
        )

        chunks = chunk_document(ingest_result, document_id=str(uuid.uuid4()))
        written = embed_and_upsert(chunks, rbac_metadata)

        return {
            'message': 'Document processed successfully',
            'document_id': str(chunks[0].document_id) if chunks else str(uuid.uuid4()),
            'filename': ingest_result.filename,
            'chunk_count': len(chunks),
            'status': 'Indexed',
        }
    except Exception as exc:
        print(f'[ai-service] ingest error: {exc}')
        raise HTTPException(status_code=500, detail=str(exc))
