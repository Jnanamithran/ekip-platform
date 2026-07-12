"""
Qdrant connection and collection management.
Connection is a module-level singleton — same rationale as the embedder,
avoid reconnecting per-request.

Payload indexes are created explicitly on every RBAC field. Without these,
Qdrant still supports filtering, but falls back to a full scan under the
hood as data grows — indexes make RBAC filtering fast at scale, which
matters since RBAC filtering runs on EVERY query, not just some.
"""

import os
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PayloadSchemaType

from .embedder import VECTOR_SIZE

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
COLLECTION_NAME = "ekip_documents"

_client: QdrantClient | None = None


def get_client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(url=QDRANT_URL)
    return _client


def ensure_collection() -> None:
    """
    Creates the collection + RBAC payload indexes if they don't exist yet.
    Safe to call on every service startup — no-op if already set up.
    """
    client = get_client()
    existing = [c.name for c in client.get_collections().collections]

    if COLLECTION_NAME not in existing:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )

        # RBAC payload indexes — filtering happens BEFORE retrieval on
        # every single query, so these must be indexed, not scanned.
        for field, schema_type in [
            ("org_id", PayloadSchemaType.KEYWORD),
            ("workspace_id", PayloadSchemaType.KEYWORD),
            ("department_id", PayloadSchemaType.KEYWORD),
            ("allowed_roles", PayloadSchemaType.KEYWORD),
            ("document_id", PayloadSchemaType.KEYWORD),
        ]:
            client.create_payload_index(
                collection_name=COLLECTION_NAME,
                field_name=field,
                field_schema=schema_type,
            )
