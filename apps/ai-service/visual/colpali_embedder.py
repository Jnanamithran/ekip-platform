"""
ColPali visual document embedder.
Embeds PDF pages as images into Qdrant collection 'ekip_visual_documents'.
Used for scanned PDFs and image-heavy documents where text extraction fails.
"""

import os
import uuid
import torch
from PIL import Image
from pathlib import Path
import fitz  # PyMuPDF - already installed

from colpali_engine.models import ColPali, ColPaliProcessor
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    Filter, FieldCondition, MatchAny, MatchValue, PayloadSchemaType
)

VISUAL_COLLECTION = "ekip_visual_documents"
COLPALI_MODEL = os.getenv("COLPALI_MODEL", "vidore/colpali-v1.2")
VECTOR_SIZE = 128  # ColPali output dimension
QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")

# Image storage path
VISUAL_STORAGE = Path("uploads/visual")
VISUAL_STORAGE.mkdir(parents=True, exist_ok=True)

# Singleton model
_model = None
_processor = None
_client = None


def get_colpali():
    global _model, _processor
    if _model is None:
        print("Loading ColPali model (first time — downloads ~5GB)...")
        _model = ColPali.from_pretrained(
            COLPALI_MODEL,
            torch_dtype=torch.bfloat16,
            device_map="cuda" if torch.cuda.is_available() else "cpu"
        ).eval()
        _processor = ColPaliProcessor.from_pretrained(COLPALI_MODEL)
        print("ColPali loaded.")
    return _model, _processor


def get_qdrant():
    global _client
    if _client is None:
        _client = QdrantClient(url=QDRANT_URL)
    return _client


def ensure_visual_collection():
    client = get_qdrant()
    existing = [c.name for c in client.get_collections().collections]
    if VISUAL_COLLECTION not in existing:
        client.create_collection(
            collection_name=VISUAL_COLLECTION,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )
        # Same RBAC indexes as text collection
        for field, schema in [
            ("org_id", PayloadSchemaType.KEYWORD),
            ("workspace_id", PayloadSchemaType.KEYWORD),
            ("department_id", PayloadSchemaType.KEYWORD),
            ("allowed_roles", PayloadSchemaType.KEYWORD),
            ("document_id", PayloadSchemaType.KEYWORD),
        ]:
            client.create_payload_index(
                collection_name=VISUAL_COLLECTION,
                field_name=field,
                field_schema=schema,
            )


def render_pdf_page(pdf_path: str, page_num: int, dpi: int = 150) -> Image.Image:
    """Render a PDF page as a PIL Image."""
    doc = fitz.open(pdf_path)
    page = doc[page_num - 1]
    pix = page.get_pixmap(dpi=dpi)
    return Image.frombytes("RGB", [pix.width, pix.height], pix.samples)


def embed_page(image: Image.Image) -> list[float]:
    """Embed a page image into a ColPali vector."""
    model, processor = get_colpali()
    inputs = processor.process_images([image])
    inputs = {k: v.to(model.device) for k, v in inputs.items()}
    with torch.no_grad():
        embeddings = model(**inputs)
    # Mean-pool patch embeddings to get single vector
    vector = embeddings[0].mean(dim=0).cpu().float().tolist()
    return vector


def embed_query(query: str) -> list[float]:
    """Embed a text query into ColPali vector space."""
    model, processor = get_colpali()
    inputs = processor.process_queries([query])
    inputs = {k: v.to(model.device) for k, v in inputs.items()}
    with torch.no_grad():
        embeddings = model(**inputs)
    return embeddings[0].mean(dim=0).cpu().float().tolist()


def embed_and_upsert_visual(
    pdf_path: str,
    document_id: str,
    filename: str,
    rbac: dict,
    total_pages: int
) -> int:
    """
    Render all pages of a PDF as images, embed with ColPali,
    and upsert into Qdrant visual collection.
    Returns number of pages upserted.
    """
    ensure_visual_collection()
    client = get_qdrant()
    points = []

    for page_num in range(1, total_pages + 1):
        # Render page as image
        image = render_pdf_page(pdf_path, page_num)

        # Save image to disk for later preview
        image_filename = f"{document_id}_page{page_num}.jpg"
        image_path = str(VISUAL_STORAGE / image_filename)
        image.save(image_path, "JPEG", quality=85)

        # Embed with ColPali
        vector = embed_page(image)

        # Build point with same RBAC payload as text pipeline
        point = PointStruct(
            id=str(uuid.uuid4()),
            vector=vector,
            payload={
                "document_id": document_id,
                "filename": filename,
                "page_num": page_num,
                "image_path": image_path,
                "pipeline": "visual",
                # RBAC fields — same as text pipeline
                "org_id": rbac["org_id"],
                "workspace_id": rbac["workspace_id"],
                "department_id": rbac["department_id"],
                "allowed_roles": rbac["allowed_roles"],
                "uploaded_by": rbac["uploaded_by"],
            }
        )
        points.append(point)

    client.upsert(collection_name=VISUAL_COLLECTION, points=points)
    return len(points)


def search_visual(query: str, rbac: dict, top_k: int = 4) -> list[dict]:
    """
    Search the visual collection with RBAC filter applied BEFORE retrieval.
    Returns top_k most visually similar pages.
    """
    client = get_qdrant()
    query_vector = embed_query(query)

    rbac_filter = Filter(must=[
        FieldCondition(key="org_id", match=MatchValue(value=rbac["org_id"])),
        FieldCondition(key="workspace_id", match=MatchValue(value=rbac["workspace_id"])),
        FieldCondition(key="department_id", match=MatchValue(value=rbac["department_id"])),
        FieldCondition(key="allowed_roles", match=MatchAny(any=rbac["allowed_roles"])),
    ])

    hits = client.search(
        collection_name=VISUAL_COLLECTION,
        query_vector=query_vector,
        query_filter=rbac_filter,
        limit=top_k,
    )

    return [hit.payload for hit in hits]