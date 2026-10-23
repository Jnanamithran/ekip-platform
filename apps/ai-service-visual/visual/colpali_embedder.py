"""
ColPali visual document embedder — Phase 2 visual pipeline.

Embeds PDF pages as images into Qdrant collection 'ekip_visual_documents'.
Used for scanned PDFs and image-heavy documents where text extraction
produces zero or near-zero content (is_scanned_or_empty = True).

How it works:
- Each PDF page is rendered as a PIL image (150 DPI)
- ColPali embeds the image into a 128-dim vector that captures
  visual layout, charts, tables, and text as a whole
- Vectors are stored in Qdrant with the same RBAC metadata as
  the text pipeline — RBAC enforced BEFORE retrieval, same rule
- At query time, the text query is embedded into the same 128-dim
  space and compared against stored page vectors

VRAM usage on RTX 3050 6GB:
  ColPali v1.2 (bfloat16): ~4.5GB
  Leave Ollama OFF when running this service to avoid OOM.
"""

import os
import uuid
import gc
import torch
from pathlib import Path
from PIL import Image
import pymupdf  # PyMuPDF

from colpali_engine.models import ColPali, ColPaliProcessor
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    Filter, FieldCondition, MatchValue, MatchAny, PayloadSchemaType,
)
from qdrant_client.http.exceptions import UnexpectedResponse

# ── Config ────────────────────────────────────────────────────────────────────
VISUAL_COLLECTION = "ekip_visual_documents"
COLPALI_MODEL     = os.getenv("COLPALI_MODEL", "vidore/colpali-v1.2")
VECTOR_SIZE       = 128   # ColPali late-interaction mean-pooled output dim
QDRANT_URL        = os.getenv("QDRANT_URL", "http://localhost:6333")
RENDER_DPI        = int(os.getenv("RENDER_DPI", "150"))

# Image storage — saved to disk so the backend can stream previews
VISUAL_STORAGE = Path(os.getenv("VISUAL_STORAGE", "uploads/visual"))
VISUAL_STORAGE.mkdir(parents=True, exist_ok=True)

# ── Singletons ────────────────────────────────────────────────────────────────
_model:     ColPali | None          = None
_processor: ColPaliProcessor | None = None
_client:    QdrantClient | None     = None


def get_colpali() -> tuple[ColPali, ColPaliProcessor]:
    global _model, _processor
    if _model is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[colpali] Loading {COLPALI_MODEL} on {device} …")
        _model = ColPali.from_pretrained(
            COLPALI_MODEL,
            torch_dtype=torch.bfloat16,
            device_map=device,
        ).eval()
        _processor = ColPaliProcessor.from_pretrained(COLPALI_MODEL)
        print("[colpali] Model ready.")
    return _model, _processor


def unload_colpali() -> None:
    """Release ColPali and its GPU memory before loading the vision generator."""
    global _model, _processor
    _model = None
    _processor = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def get_qdrant() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(url=QDRANT_URL)
    return _client


# ── Qdrant collection setup ───────────────────────────────────────────────────

def ensure_visual_collection() -> None:
    client = get_qdrant()
    names = [c.name for c in client.get_collections().collections]
    if VISUAL_COLLECTION not in names:
        client.create_collection(
            collection_name=VISUAL_COLLECTION,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )
        # Same RBAC payload indexes as the text pipeline
        for field, schema in [
            ("org_id",        PayloadSchemaType.KEYWORD),
            ("workspace_id",  PayloadSchemaType.KEYWORD),
            ("department_id", PayloadSchemaType.KEYWORD),
            ("allowed_role_ids", PayloadSchemaType.KEYWORD),
            ("document_id",   PayloadSchemaType.KEYWORD),
        ]:
            client.create_payload_index(
                collection_name=VISUAL_COLLECTION,
                field_name=field,
                field_schema=schema,
            )
        print(f"[colpali] Created Qdrant collection '{VISUAL_COLLECTION}'.")


# ── Core embedding helpers ────────────────────────────────────────────────────

def render_page(pdf_path: str, page_num: int) -> Image.Image:
    """Render one PDF page (1-based) as a PIL RGB image."""
    doc  = pymupdf.open(pdf_path)
    page = doc[page_num - 1]
    pix  = page.get_pixmap(dpi=RENDER_DPI)
    return Image.frombytes("RGB", [pix.width, pix.height], pix.samples)


def embed_image(image: Image.Image) -> list[float]:
    """Embed a single page image → 128-dim ColPali vector."""
    model, processor = get_colpali()
    inputs = processor.process_images([image])
    inputs = {k: v.to(model.device) for k, v in inputs.items()}
    with torch.no_grad():
        embeddings = model(**inputs)
    # Mean-pool over patch tokens → single fixed-size vector
    vector = embeddings[0].mean(dim=0).cpu().float().tolist()
    return vector


def embed_query(query: str) -> list[float]:
    """Embed a text query into the same ColPali vector space."""
    model, processor = get_colpali()
    inputs = processor.process_queries([query])
    inputs = {k: v.to(model.device) for k, v in inputs.items()}
    with torch.no_grad():
        embeddings = model(**inputs)
    return embeddings[0].mean(dim=0).cpu().float().tolist()


# ── Public API ────────────────────────────────────────────────────────────────

def embed_and_upsert_visual(
    pdf_path:    str,
    document_id: str,
    filename:    str,
    rbac:        dict,   # keys: org_id, workspace_id, department_id, allowed_role_ids, uploaded_by
    total_pages: int,
) -> int:
    """
    Render all pages of a scanned PDF, embed with ColPali, and upsert
    into Qdrant with RBAC metadata attached at write time.

    Returns the number of pages successfully upserted.
    """
    ensure_visual_collection()
    client = get_qdrant()
    points = []

    for page_num in range(1, total_pages + 1):
        print(f"[colpali] Embedding page {page_num}/{total_pages} …")

        image = render_page(pdf_path, page_num)

        # Save rendered image to disk for PDF preview endpoint
        image_filename = f"{document_id}_page{page_num}.jpg"
        image_path     = str(VISUAL_STORAGE / image_filename)
        image.save(image_path, "JPEG", quality=85)

        vector = embed_image(image)

        points.append(PointStruct(
            id     = str(uuid.uuid4()),
            vector = vector,
            payload = {
                # Citation fields
                "document_id": document_id,
                "filename":    filename,
                "page_num":    page_num,
                "image_path":  image_path,
                "pipeline":    "visual",
                # RBAC fields — same as text pipeline
                "org_id":        rbac["org_id"],
                "workspace_id":  rbac["workspace_id"],
                "department_id": rbac["department_id"],
                "allowed_role_ids": rbac["allowed_role_ids"],
                "uploaded_by":   rbac["uploaded_by"],
            },
        ))

    client.upsert(collection_name=VISUAL_COLLECTION, points=points)
    print(f"[colpali] Upserted {len(points)} pages for document {document_id}.")
    return len(points)


def search_visual(
    query:   str,
    rbac:    dict,   # keys: org_id, workspace_id, department_id, role_id, is_owner
    top_k:   int = 4,
) -> list[dict]:
    """
    Search the visual collection.
    RBAC filter is applied BEFORE the vector search — same rule as the
    text pipeline: unauthorized pages never leave Qdrant.

    Returns a list of payloads for the top_k most visually similar pages.
    """
    client       = get_qdrant()
    query_vector = embed_query(query)

    conditions = [
        FieldCondition(key="org_id", match=MatchValue(value=rbac["org_id"])),
        FieldCondition(key="workspace_id", match=MatchValue(value=rbac["workspace_id"])),
    ]
    if not rbac["is_owner"]:
        department_ids = rbac.get("department_ids") or [rbac["department_id"]]
        if not department_ids:
            return []
        conditions.extend([
            FieldCondition(
                key="allowed_role_ids",
                match=MatchValue(value=rbac["role_id"]),
            ),
            FieldCondition(
                key="department_id",
                match=MatchAny(any=department_ids),
            ),
        ])
    rbac_filter = Filter(must=conditions)

    try:
        response = client.query_points(
            collection_name = VISUAL_COLLECTION,
            query           = query_vector,
            query_filter    = rbac_filter,
            limit           = top_k,
            with_payload    = True,
        )
    except UnexpectedResponse as exc:
        if getattr(exc, "status_code", None) == 404:
            return []
        raise
    except ValueError:
        return []

    hits = response.points
    return [
        {
            "document_id": hit.payload.get("document_id"),
            "filename":    hit.payload.get("filename"),
            "page_num":    hit.payload.get("page_num"),
            "image_path":  hit.payload.get("image_path"),
            "score":       hit.score,
        }
        for hit in hits
    ]


def delete_visual_document(document_id: str) -> int:
    """
    Delete all visual pages for a document from Qdrant.
    Called when the backend deletes a document.
    Returns number of points deleted.
    """
    client = get_qdrant()
    result = client.delete(
        collection_name = VISUAL_COLLECTION,
        points_selector = Filter(must=[
            FieldCondition(key="document_id", match=MatchValue(value=document_id)),
        ]),
    )
    return getattr(result, "deleted", 0)
