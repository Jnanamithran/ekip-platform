"""
BM25 sparse retrieval (Step 4).

Deliberately NOT persisted. A fresh BM25 index is built in-memory, per
query, from ONLY the chunks that fetch_authorized_chunks() (Step 5)
already determined this user can see. This means BM25 never scores
against unauthorized content, not even internally — the strongest
version of "RBAC before retrieval" available without a persisted,
partitioned index architecture.

Trade-off accepted: rebuilding the index per query costs some latency
vs. a persisted index. At this project's realistic scale (a few thousand
chunks per workspace), this is milliseconds, not a bottleneck.
"""

import re
from typing import List, Dict, Any
from rank_bm25 import BM25Okapi

from .schema import RetrievedChunk

_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> List[str]:
    """Lowercase, alphanumeric-only tokenization. Simple and fast —
    BM25 doesn't need stemming/lemmatization to be effective."""
    return _TOKEN_PATTERN.findall(text.lower())


def bm25_search(
    query: str,
    authorized_chunks: List[Dict[str, Any]],
    top_k: int = 10,
) -> List[RetrievedChunk]:
    """
    Scores `query` against only the given authorized chunks.
    Returns the top_k highest-scoring chunks, sorted descending by score.
    """
    if not authorized_chunks:
        return []

    corpus_tokens = [_tokenize(chunk["text"]) for chunk in authorized_chunks]
    bm25 = BM25Okapi(corpus_tokens)

    query_tokens = _tokenize(query)
    scores = bm25.get_scores(query_tokens)

    scored_chunks = list(zip(authorized_chunks, scores))
    scored_chunks.sort(key=lambda pair: pair[1], reverse=True)

    results = []
    for chunk, score in scored_chunks[:top_k]:
        if score <= 0:
            # BM25 gives 0 to chunks with zero term overlap — not a real match,
            # don't pad results with irrelevant chunks just to hit top_k.
            continue
        results.append(
            RetrievedChunk(
                chunk_id=str(chunk["chunk_id"]),
                document_id=chunk["document_id"],
                filename=chunk["filename"],
                page_num=chunk["page_num"],
                text=chunk["text"],
                score=float(score),
                source="sparse",
            )
        )

    return results
