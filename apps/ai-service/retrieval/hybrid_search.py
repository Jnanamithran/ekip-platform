"""
Hybrid Retrieval — Step 6.

Combines dense (semantic) and sparse (BM25) retrieval results using
Reciprocal Rank Fusion (RRF). Neither method alone is sufficient:

  Dense   — finds semantically similar chunks even when exact words differ.
             Weak on precise keyword matches and rare terms.
  Sparse  — finds exact keyword matches. Weak on paraphrasing and synonyms.
  RRF     — merges both ranked lists into one superior ranking without
             needing to normalise raw scores (which differ wildly between
             cosine similarity and BM25). Score is purely rank-based.

RRF formula for a chunk c across ranked lists L1, L2, ...:
    rrf_score(c) = Σ  1 / (k + rank(c, Lᵢ))
where k=60 is the standard smoothing constant (from the original RRF paper).
A higher combined score = higher rank in the final merged list.

RBAC is NOT re-enforced here — it was already enforced before both
input lists were produced. This module only touches chunks that were
already authorised; it does not add or remove any.
"""

from typing import List, Dict
from .schema import RBACContext, RetrievedChunk

# Standard RRF smoothing constant (Cormack et al., 2009).
# k=60 is the widely accepted default — do not change without benchmarking.
RRF_K = 60


def _rrf_score(rank: int, k: int = RRF_K) -> float:
    """Score for a single chunk at a given 1-based rank in one list."""
    return 1.0 / (k + rank)


def reciprocal_rank_fusion(
    dense_results: List[RetrievedChunk],
    sparse_results: List[RetrievedChunk],
    top_k: int = 10,
) -> List[RetrievedChunk]:
    """
    Fuse dense and sparse result lists with RRF.

    Args:
        dense_results:  Ranked chunks from vector (semantic) search.
                        chunk.source must be "dense".
        sparse_results: Ranked chunks from BM25 keyword search.
                        chunk.source must be "sparse".
        top_k:          Number of results to return after fusion.

    Returns:
        A new list of RetrievedChunk objects, re-scored with their RRF
        score and re-ranked. source is set to "hybrid".
        Length is min(top_k, total unique chunks across both lists).
    """
    # ── accumulate RRF scores keyed by chunk_id ───────────────────────────
    rrf_scores: Dict[str, float] = {}

    # Store the best payload we've seen for each chunk_id so we can
    # reconstruct a RetrievedChunk after scoring.
    chunk_payloads: Dict[str, RetrievedChunk] = {}

    for rank, chunk in enumerate(dense_results, start=1):
        rrf_scores[chunk.chunk_id] = rrf_scores.get(chunk.chunk_id, 0.0) + _rrf_score(rank)
        chunk_payloads[chunk.chunk_id] = chunk

    for rank, chunk in enumerate(sparse_results, start=1):
        rrf_scores[chunk.chunk_id] = rrf_scores.get(chunk.chunk_id, 0.0) + _rrf_score(rank)
        # Only overwrite payload if we haven't seen this chunk yet
        # (dense payload is preferred since it has a cosine score attached).
        if chunk.chunk_id not in chunk_payloads:
            chunk_payloads[chunk.chunk_id] = chunk

    # ── sort by descending RRF score ──────────────────────────────────────
    ranked_ids = sorted(rrf_scores, key=lambda cid: rrf_scores[cid], reverse=True)

    # ── build output list ─────────────────────────────────────────────────
    fused: List[RetrievedChunk] = []
    for chunk_id in ranked_ids[:top_k]:
        original = chunk_payloads[chunk_id]
        fused.append(
            RetrievedChunk(
                chunk_id    = original.chunk_id,
                document_id = original.document_id,
                filename    = original.filename,
                page_num    = original.page_num,
                text        = original.text,
                score       = round(rrf_scores[chunk_id], 6),  # RRF score replaces raw score
                source      = "hybrid",   # marks this as a fused result
            )
        )

    return fused