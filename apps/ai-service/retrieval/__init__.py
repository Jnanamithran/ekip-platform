from typing import Any

from .schema import RBACContext, RetrievedChunk


def sparse_retrieve(
    query: str,
    rbac: RBACContext,
    top_k: int = 10,
) -> list[RetrievedChunk]:
    from .service import sparse_retrieve as retrieve

    return retrieve(query, rbac, top_k)


def fetch_authorized_chunks(rbac: RBACContext) -> list[dict[str, Any]]:
    from .rbac_filter import fetch_authorized_chunks as fetch

    return fetch(rbac)


def bm25_search(
    query: str,
    authorized_chunks: list[dict[str, Any]],
    top_k: int = 10,
) -> list[RetrievedChunk]:
    from .sparse_search import bm25_search as search

    return search(query, authorized_chunks, top_k)


__all__ = [
    "sparse_retrieve",
    "RBACContext",
    "RetrievedChunk",
    "fetch_authorized_chunks",
    "bm25_search",
]
