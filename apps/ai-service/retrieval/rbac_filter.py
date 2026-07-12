"""
RBAC metadata filter (Step 5).

This is the enforcement point for the platform's core rule: authorization
happens BEFORE retrieval. This function does a metadata-ONLY query against
Qdrant — no vector search involved — so it returns exactly the set of
chunks a user is permitted to see, and nothing else ever leaves Qdrant.

Both sparse (BM25, this module) and dense (Step 6 fusion) retrieval call
this same function to get their authorized candidate pool. One RBAC
enforcement point, not two — avoids the two retrieval paths drifting out
of sync on what "authorized" means.
"""

from typing import List, Dict, Any
from qdrant_client.models import Filter, FieldCondition, MatchValue

from embeddings.qdrant_client import get_client, COLLECTION_NAME
from .schema import RBACContext

# Safety ceiling — prevents a pathologically large workspace from stalling
# a query. Real pagination can be added later if a workspace exceeds this.
MAX_AUTHORIZED_CHUNKS = 5000


def fetch_authorized_chunks(rbac: RBACContext) -> List[Dict[str, Any]]:
    """
    Returns the payloads (with chunk_id) of every chunk this user is
    authorized to see, scoped to their org/workspace/department, with
    their role checked against each chunk's allowed_roles list.
    """
    client = get_client()

    query_filter = Filter(
        must=[
            FieldCondition(key="org_id", match=MatchValue(value=rbac.org_id)),
            FieldCondition(key="workspace_id", match=MatchValue(value=rbac.workspace_id)),
            FieldCondition(key="department_id", match=MatchValue(value=rbac.department_id)),
            FieldCondition(key="allowed_roles", match=MatchValue(value=rbac.role)),
        ]
    )

    records, _next_offset = client.scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=query_filter,
        limit=MAX_AUTHORIZED_CHUNKS,
        with_payload=True,
        with_vectors=False,   # metadata-only — no vector data needed for BM25
    )

    authorized = []
    for record in records:
        payload = record.payload or {}
        payload["chunk_id"] = record.id
        authorized.append(payload)

    return authorized
