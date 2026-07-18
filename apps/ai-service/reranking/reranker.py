"""
Reranking — Step 7.

Takes the fused hybrid retrieval results (Step 6 RRF output) and
re-scores each chunk against the original query using a cross-encoder.

Why reranking is necessary
──────────────────────────
Both dense and sparse retrieval use BI-encoders — they embed the query
and each chunk independently, then compare vectors. This is fast but
imprecise: the model never sees the query and chunk together.

A cross-encoder sees the (query, chunk) pair jointly and produces a
much more accurate relevance score. It's too slow to run over thousands
of chunks, which is why we use it AFTER hybrid retrieval has already
narrowed the candidate set to a small top-k (typically 10–20).

Pipeline position
─────────────────
hybrid_retrieve(query, rbac, top_k=20)   ← Step 6
        ↓
rerank(query, chunks, top_n=5)           ← Step 7  (this module)
        ↓
Ollama LLM generation                    ← Step 8

Model choice
────────────
cross-encoder/ms-marco-MiniLM-L-6-v2
  - Trained on MS MARCO passage ranking (140M query-passage pairs)
  - 6-layer MiniLM — fast enough for real-time use on CPU or GPU
  - Scores are raw logits (not 0–1), higher = more relevant
  - Safe on RTX 3050 6GB alongside the embedding model
"""

from typing import List
from sentence_transformers import CrossEncoder

from retrieval.schema import RetrievedChunk

# ── Model ────────────────────────────────────────────────────────────────────
# Loaded once at module import time — not per request.
# First call downloads ~80MB to the HuggingFace cache (~/.cache/huggingface).
# Subsequent calls load from cache instantly.
_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
_reranker: CrossEncoder | None = None


def _get_reranker() -> CrossEncoder:
    """Lazy singleton loader — model loads on first rerank() call."""
    global _reranker
    if _reranker is None:
        print(f"  [reranker] Loading {_MODEL_NAME} …")
        _reranker = CrossEncoder(_MODEL_NAME, max_length=512)
        print(f"  [reranker] Model ready.")
    return _reranker


# ── Public API ────────────────────────────────────────────────────────────────

def rerank(
    query: str,
    chunks: List[RetrievedChunk],
    top_n: int = 5,
) -> List[RetrievedChunk]:
    """
    Re-score a list of retrieved chunks against the query using a
    cross-encoder, then return the top_n most relevant chunks.

    Args:
        query:   The original natural language question from the user.
        chunks:  Hybrid retrieval results (Step 6 output). Order does
                 not matter — all chunks are scored independently.
        top_n:   Number of chunks to return after reranking.
                 Should be <= len(chunks). Typically 3–5 for LLM context.

    Returns:
        A new list of RetrievedChunk, re-scored with the cross-encoder
        logit score, sorted descending, length = min(top_n, len(chunks)).
        source is set to "reranked".

    Notes:
        - Scores are raw logits — higher is more relevant, no fixed range.
        - An empty chunks list returns an empty list without model inference.
        - If top_n > len(chunks), all chunks are returned (no padding).
    """
    if not chunks:
        return []

    model = _get_reranker()

    # Build (query, chunk_text) pairs — the cross-encoder scores each jointly
    pairs = [(query, chunk.text) for chunk in chunks]

    # scores is a numpy array of raw logits, one per pair
    scores = model.predict(pairs)

    # Attach scores and sort descending
    scored = sorted(
        zip(scores, chunks),
        key=lambda x: x[0],
        reverse=True,
    )

    reranked = []
    for score, chunk in scored[:top_n]:
        reranked.append(
            RetrievedChunk(
                chunk_id    = chunk.chunk_id,
                document_id = chunk.document_id,
                filename    = chunk.filename,
                page_num    = chunk.page_num,
                text        = chunk.text,
                score       = float(score),   # cross-encoder logit replaces RRF score
                source      = "reranked",
            )
        )

    return reranked