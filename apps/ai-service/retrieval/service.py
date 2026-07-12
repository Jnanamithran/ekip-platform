"""
Sparse retrieval orchestrator.
Combines Step 5 (RBAC filter) and Step 4 (BM25) into a single call:
fetch only what this user is authorized to see, then rank it by keyword
relevance to their query.
"""

from typing import List

from .schema import RBACContext, RetrievedChunk
from .rbac_filter import fetch_authorized_chunks
from .sparse_search import bm25_search


def sparse_retrieve(query: str, rbac: RBACContext, top_k: int = 10) -> List[RetrievedChunk]:
    authorized_chunks = fetch_authorized_chunks(rbac)
    return bm25_search(query, authorized_chunks, top_k=top_k)
