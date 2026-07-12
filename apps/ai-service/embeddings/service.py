"""
Embedding orchestrator.
Takes chunks (from the chunking module) + RBAC metadata (from the caller —
the Node backend, which knows the uploader's org/workspace/dept context),
generates dense vectors, and upserts into Qdrant with the full payload.

This is the point where RBAC metadata gets permanently attached to each
vector. There is no "add RBAC later" path — it's baked in at write time,
enforcing the platform's core rule that authorization is structural, not
a filter bolted on after retrieval.
"""

from typing import List, TYPE_CHECKING
from qdrant_client.models import PointStruct

from .embedder import embed_texts
from .qdrant_client import get_client, ensure_collection, COLLECTION_NAME
from .rbac_schema import RBACMetadata

if TYPE_CHECKING:
    from chunking.schema import Chunk


def embed_and_upsert(chunks: List["Chunk"], rbac: RBACMetadata) -> int:
    """
    Embeds all chunks and upserts them into Qdrant with RBAC + citation
    metadata attached. Returns the number of points written.
    """
    if not chunks:
        return 0

    ensure_collection()

    texts = [c.text for c in chunks]
    vectors = embed_texts(texts)

    points = []
    for chunk, vector in zip(chunks, vectors):
        payload = {
            # citation fields (Step 9 needs these to trace an answer back)
            "document_id": chunk.document_id,
            "filename": chunk.filename,
            "file_type": chunk.file_type,
            "page_num": chunk.page_num,
            "chunk_index": chunk.chunk_index,
            "text": chunk.text,
            # RBAC fields (Step 5 filters on these BEFORE any search runs)
            **rbac.as_payload(),
        }
        points.append(
            PointStruct(id=chunk.chunk_id, vector=vector, payload=payload)
        )

    client = get_client()
    client.upsert(collection_name=COLLECTION_NAME, points=points)

    return len(points)
