"""
EKIP Visual AI Service — Phase 2
FastAPI microservice for ColPali visual document embedding and retrieval.
Runs on port 8001 (separate from the text AI service on port 8000).

Endpoints:
  POST /visual/ingest  — render + embed all pages of a scanned PDF
  POST /visual/search  — search visual collection with RBAC filter
  DELETE /visual/document/{document_id} — remove all pages for a document
  GET  /health         — liveness check
"""

import os
import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ValidationError

from visual.colpali_embedder import (
    embed_and_upsert_visual,
    search_visual,
    delete_visual_document,
)

app = FastAPI(title="EKIP Visual AI Service", version="0.1.0")


# ── Request / Response schemas ────────────────────────────────────────────────

class RBACInfo(BaseModel):
    org_id:        str
    workspace_id:  str
    department_id: str
    role:          str
    allowed_roles: list[str]
    uploaded_by:   str


class VisualSearchRequest(BaseModel):
    query:       str
    org_id:      str
    workspace_id: str
    department_id: str
    role:        str
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
        import fitz
        doc         = fitz.open(str(tmp_path))
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
            "allowed_roles": rbac_info.allowed_roles,
            "uploaded_by":   rbac_info.uploaded_by,
        }

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
def search(req: VisualSearchRequest):
    """
    Search the visual Qdrant collection.
    RBAC filter applied BEFORE vector search — same rule as the text pipeline.
    """
    try:
        rbac = {
            "org_id":        req.org_id,
            "workspace_id":  req.workspace_id,
            "department_id": req.department_id,
            "role":          req.role,
        }

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


@app.delete("/visual/document/{document_id}")
def delete_document(document_id: str):
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