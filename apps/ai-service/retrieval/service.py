"""
Retrieval orchestrator — Steps 4, 5, and 6.

Exposes two public functions:

  sparse_retrieve(query, rbac, top_k)
      Step 4 + 5: RBAC filter → BM25. Used in v0.1 demo and as an
      internal building block for hybrid_retrieve.

  hybrid_retrieve(query, rbac, top_k)
      Step 6: RBAC filter → dense search + BM25 → RRF fusion.
      This is the primary retrieval function from v0.2 onwards.
      sparse_retrieve is kept for comparison / ablation only.

The reranker (Step 7) will wrap hybrid_retrieve — it calls this
function first, then re-scores the fused top-k with a cross-encoder.
"""

from typing import List

from .schema import RBACContext, RetrievedChunk
from .rbac_filter import fetch_authorized_chunks
from .sparse_search import bm25_search
from .hybrid_search import reciprocal_rank_fusion

# Dense search imports — embedder + Qdrant client live in the embeddings module.
# Retrieval calls into embeddings here; embeddings never calls into retrieval.
from embeddings.embedder import embed_texts
from embeddings.qdrant_client import get_client, COLLECTION_NAME
from qdrant_client.models import Filter, FieldCondition, MatchValue


# ── internal helper ───────────────────────────────────────────────────────────

def _dense_search(
    query: str,
    rbac: RBACContext,
    top_k: int,
) -> List[RetrievedChunk]:
    """
    Embed the query and search Qdrant with an RBAC filter.
    Returns top_k results as RetrievedChunk objects (source="dense").

    This is intentionally private — callers use hybrid_retrieve, not
    this function directly. Keeping it private prevents dense-only
    retrieval from bypassing RRF in production code paths.
    """
    query_vector = embed_texts([query])[0]

    qdrant_filter = Filter(
        must=[
            FieldCondition(key="org_id",        match=MatchValue(value=rbac.org_id)),
            FieldCondition(key="workspace_id",  match=MatchValue(value=rbac.workspace_id)),
            FieldCondition(key="department_id", match=MatchValue(value=rbac.department_id)),
            FieldCondition(key="allowed_roles", match=MatchValue(value=rbac.role)),
        ]
    )

    client = get_client()
    hits = client.search(
        collection_name = COLLECTION_NAME,
        query_vector    = query_vector,
        query_filter    = qdrant_filter,
        limit           = top_k,
        with_payload    = True,
    )

    results = []
    for hit in hits:
        p = hit.payload or {}
        results.append(
            RetrievedChunk(
                chunk_id    = str(hit.id),
                document_id = p.get("document_id", ""),
                filename    = p.get("filename", ""),
                page_num    = p.get("page_num", 0),
                text        = p.get("text", ""),
                score       = hit.score,
                source      = "dense",
            )
        )
    return results


# ── public API ────────────────────────────────────────────────────────────────

def sparse_retrieve(
    query: str,
    rbac: RBACContext,
    top_k: int = 10,
) -> List[RetrievedChunk]:
    """
    Steps 4 + 5: RBAC filter → BM25 keyword search.
    Kept as a standalone function for the v0.1 demo and ablation testing.
    Not the primary retrieval path from v0.2 onwards.
    """
    authorized_chunks = fetch_authorized_chunks(rbac)
    return bm25_search(query, authorized_chunks, top_k=top_k)


def hybrid_retrieve(
    query: str,
    rbac: RBACContext,
    top_k: int = 10,
    rrf_candidate_k: int = 20,
) -> List[RetrievedChunk]:
    """
    Step 6: Hybrid retrieval via Reciprocal Rank Fusion.

    Runs dense and sparse retrieval independently over the RBAC-filtered
    candidate set, then fuses their ranked lists with RRF.

    Args:
        query:           Natural language question from the user.
        rbac:            The requesting user's org/workspace/dept/role.
        top_k:           Final number of fused results to return.
                         The reranker (Step 7) will further reduce this.
        rrf_candidate_k: How many candidates each retriever fetches before
                         fusion. Larger = better recall for RRF at the cost
                         of slightly more compute. 20 is a safe default.

    Returns:
        List of RetrievedChunk, scored by RRF, source="hybrid", length <= top_k.
    """
    # Both retrievers operate on the same RBAC-filtered candidate set.
    # Dense search re-enforces RBAC via Qdrant metadata filter (same fields).
    # BM25 re-enforces RBAC by only scoring against fetch_authorized_chunks output.
    # Both paths are independently correct — RRF just merges their rankings.

    dense_results  = _dense_search(query, rbac, top_k=rrf_candidate_k)
    sparse_results = sparse_retrieve(query, rbac, top_k=rrf_candidate_k)

    return reciprocal_rank_fusion(dense_results, sparse_results, top_k=top_k)