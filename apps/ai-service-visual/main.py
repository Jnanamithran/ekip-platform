"""
EKIP Visual AI Service — Phase 2
FastAPI microservice for ColPali visual document embedding and retrieval.
Runs on port 8001 (separate from the text AI service on port 8000).

Endpoints:
  POST /visual/ingest   — render + embed all pages of a scanned PDF
  POST /visual/search   — search visual collection with RBAC filter
  POST /visual/ask      — ColPali retrieve + Qwen2-VL answer (visual QA)
  DELETE /visual/document/{document_id} — remove all pages for a document
  GET  /health          — liveness check
"""

import os
import threading

# Auto-load apps/ai-service-visual/.env if present (uvicorn does not load .env by itself).
_env_file = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_env_file):
    with open(_env_file, encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _key, _sep, _val = _line.partition("=")
            _key = _key.strip()
            _val = _val.strip()
            if _key and _key not in os.environ:
                os.environ[_key] = _val

print(
    "[visual-ai] Hugging Face cache: "
    + os.environ.get(
        "HF_HOME",
        os.path.join(os.path.expanduser("~"), ".cache", "huggingface"),
    )
)

import secrets
import tempfile
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, ValidationError

from visual.colpali_embedder import (
    embed_and_upsert_visual,
    search_visual,
    delete_visual_document,
    unload_colpali,
)
from visual.qwen_generator import answer_from_images, QWEN_MODEL, unload_qwen
from PIL import Image

app = FastAPI(title="EKIP Visual AI Service", version="0.1.0")
AI_SERVICE_API_KEY = os.getenv("AI_SERVICE_API_KEY", "")
_visual_model_lock = threading.RLock()


async def require_ai_service_key(x_ekip_service_key: str | None = Header(default=None)):
    if len(AI_SERVICE_API_KEY) < 32:
        raise HTTPException(status_code=503, detail="Visual service authentication is not configured")
    if not x_ekip_service_key or not secrets.compare_digest(
        x_ekip_service_key,
        AI_SERVICE_API_KEY,
    ):
        raise HTTPException(status_code=401, detail="Invalid service credentials")


# ── Request / Response schemas ────────────────────────────────────────────────

class RBACInfo(BaseModel):
    org_id:        str
    workspace_id:  str
    department_id: str
    allowed_role_ids: list[str]
    uploaded_by:   str


class VisualSearchRequest(BaseModel):
    query:       str
    org_id:      str
    workspace_id: str
    department_id: str
    department_ids: list[str] = []
    role_id:     str
    is_owner:    bool = False
    top_k:       int = 4


class VisualSearchResult(BaseModel):
    document_id: str
    filename:    str
    page_num:    int
    image_path:  str
    score:       float


class VisualSearchResponse(BaseModel):
    results: list[VisualSearchResult]
    query:   str


class IngestResponse(BaseModel):
    message:     str
    document_id: str
    filename:    str
    pages_upserted: int
    pipeline:    str = "visual"


class VisualQARequest(BaseModel):
    question:     str
    org_id:       str
    workspace_id: str
    department_id: str
    department_ids: list[str] = []
    role_id:      str
    is_owner:     bool = False
    top_k:        int = 4


class VisualCitation(BaseModel):
    filename:   str
    page_num:   int
    text:       str
    type:       str = "visual"
    document_id: str


class VisualQAResponse(BaseModel):
    answer:   str
    citations: list[VisualCitation]
    model:    str
    pipeline: str = "visual"


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status":  "ok",
        "service": "ekip-visual-ai",
        "version": "0.1.0",
    }


@app.post("/visual/ingest", response_model=IngestResponse)
async def ingest(
    _service_key: None = Depends(require_ai_service_key),
    rbac:        str        = Form(...),   # JSON-encoded RBACInfo
    document_id: str        = Form(...),
    file:        UploadFile = File(...),
):
    """
    Receive a scanned PDF, render every page as an image,
    embed with ColPali, and upsert into Qdrant with RBAC metadata.

    Called by the main AI service when ingest_document() returns
    is_scanned_or_empty = True.
    """
    # Validate inputs
    try:
        rbac_info   = RBACInfo.model_validate_json(rbac)
        document_id = str(uuid.UUID(document_id))
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    filename = os.path.basename((file.filename or "upload").replace("\\", "/"))

    # Write uploaded file to a temp location
    suffix   = Path(filename).suffix
    tmp_path = Path(tempfile.gettempdir()) / f"{uuid.uuid4()}{suffix}"
    try:
        tmp_path.write_bytes(await file.read())

        # Count pages using PyMuPDF (already a dependency via colpali_embedder)
        import pymupdf
        doc         = pymupdf.open(str(tmp_path))
        total_pages = len(doc)
        doc.close()

        if total_pages == 0:
            raise HTTPException(
                status_code=422,
                detail="PDF has zero pages — nothing to embed.",
            )

        rbac_dict = {
            "org_id":        rbac_info.org_id,
            "workspace_id":  rbac_info.workspace_id,
            "department_id": rbac_info.department_id,
            "allowed_role_ids": rbac_info.allowed_role_ids,
            "uploaded_by":   rbac_info.uploaded_by,
        }

        with _visual_model_lock:
            pages_upserted = embed_and_upsert_visual(
                pdf_path    = str(tmp_path),
                document_id = document_id,
                filename    = filename,
                rbac        = rbac_dict,
                total_pages = total_pages,
            )

        return IngestResponse(
            message        = "Visual document processed successfully",
            document_id    = document_id,
            filename       = filename,
            pages_upserted = pages_upserted,
        )

    except HTTPException:
        raise
    except Exception as exc:
        print(f"[visual-ai] ingest error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


@app.post("/visual/search", response_model=VisualSearchResponse)
def search(
    req: VisualSearchRequest,
    _service_key: None = Depends(require_ai_service_key),
):
    """
    Search the visual Qdrant collection.
    RBAC filter applied BEFORE vector search — same rule as the text pipeline.
    """
    try:
        rbac = {
            "org_id":        req.org_id,
            "workspace_id":  req.workspace_id,
            "department_id": req.department_id,
            "department_ids": req.department_ids or [req.department_id],
            "role_id":       req.role_id,
            "is_owner":      req.is_owner,
        }

        with _visual_model_lock:
            raw_results = search_visual(
                query  = req.query,
                rbac   = rbac,
                top_k  = req.top_k,
            )

        results = [
            VisualSearchResult(
                document_id = r["document_id"],
                filename    = r["filename"],
                page_num    = r["page_num"],
                image_path  = r["image_path"],
                score       = r["score"],
            )
            for r in raw_results
        ]

        return VisualSearchResponse(results=results, query=req.query)

    except Exception as exc:
        print(f"[visual-ai] search error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/visual/ask", response_model=VisualQAResponse)
async def ask_visual(
    req: VisualQARequest,
    _service_key: None = Depends(require_ai_service_key),
):
    """
    Full visual QA pipeline:
      1. ColPali retrieval with RBAC filter (before retrieval — always)
      2. Load page images from disk
      3. Qwen2-VL generates grounded answer from page images
    """
    try:
        print("[visual] /visual/ask received")
        rbac = {
            "org_id":        req.org_id,
            "workspace_id":  req.workspace_id,
            "department_id": req.department_id,
            "department_ids": req.department_ids or [req.department_id],
            "role_id":       req.role_id,
            "is_owner":      req.is_owner,
        }

        with _visual_model_lock:
            try:
                # Step 1: ColPali retrieval — RBAC applied BEFORE retrieval
                print("[visual] ColPali start")
                top_pages = search_visual(
                    query  = req.question,
                    rbac   = rbac,
                    top_k  = req.top_k,
                )
                print(f"[visual] ColPali returned {len(top_pages)} pages")

                if not top_pages:
                    print("[visual] No accessible visual pages; skipping Qwen2-VL")
                    return VisualQAResponse(
                        answer   = "No relevant visual content found in your accessible documents.",
                        citations = [],
                        model    = QWEN_MODEL,
                    )

                # Step 2: Load page images from disk
                images = []
                filenames = []
                page_nums = []
                document_ids = []
                for page in top_pages:
                    try:
                        img = Image.open(page["image_path"])
                        images.append(img)
                        filenames.append(page["filename"])
                        page_nums.append(page["page_num"])
                        document_ids.append(page["document_id"])
                    except Exception:
                        continue

                if not images:
                    print("[visual] Retrieved pages had no loadable images; skipping Qwen2-VL")
                    return VisualQAResponse(
                        answer   = "Found matching pages but could not load their images.",
                        citations = [],
                        model    = QWEN_MODEL,
                    )

                # The GPU cannot hold both models on supported 6-GB cards.
                unload_colpali()
                try:
                    print("[visual] Qwen2-VL loading")
                    result = answer_from_images(
                        question    = req.question,
                        page_images = images,
                        filenames   = filenames,
                        page_nums   = page_nums,
                        document_ids = document_ids,
                    )
                    print("[visual] Qwen2-VL done")
                finally:
                    unload_qwen()

                return VisualQAResponse(
                    answer    = result["answer"],
                    citations = [
                        VisualCitation(
                            filename    = c["filename"],
                            page_num    = c["page_num"],
                            text        = c["text"],
                            type        = c.get("type", "visual"),
                            document_id = c.get("document_id", "unknown"),
                        )
                        for c in result["citations"]
                    ],
                    model   = result["model"],
                )
            finally:
                unload_colpali()

    except Exception as exc:
        print(f"[visual-ai] ask error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/visual/document/{document_id}")
def delete_document(
    document_id: str,
    _service_key: None = Depends(require_ai_service_key),
):
    """
    Remove all visual pages for a document from Qdrant.
    Called when the backend deletes a document.
    """
    try:
        deleted = delete_visual_document(document_id)
        return {
            "message":     "Visual document deleted",
            "document_id": document_id,
            "deleted":     deleted,
        }
    except Exception as exc:
        print(f"[visual-ai] delete error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))