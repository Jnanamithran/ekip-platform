"""Unit tests for the retrieval layer (Steps 4-5).

bm25_search is pure in-memory (rank-bm25); the RBAC filter test mocks the
Qdrant client so no live Qdrant is needed.
"""

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

SVC_DIR = Path(__file__).resolve().parents[1]
if str(SVC_DIR) not in sys.path:
    sys.path.insert(0, str(SVC_DIR))

rank_bm25 = pytest.importorskip("rank_bm25", reason="rank-bm25 not installed")

from retrieval.sparse_search import bm25_search  # noqa: E402
from retrieval.schema import RBACContext  # noqa: E402


def make_chunks(texts):
    return [
        {"chunk_id": f"c{i}", "document_id": "doc-1",
         "filename": "test.pdf", "page_num": i + 1, "text": t}
        for i, t in enumerate(texts)
    ]


def test_bm25_ranks_relevant_chunk_first():
    chunks = make_chunks([
        "RBAC enforcement policy access control before retrieval",
        "Quarterly revenue figures marketing budget allocation",
        "Employee onboarding schedule office seating arrangement",
    ])
    # NOTE: 3+ chunks are needed — with only 2 docs, rank-bm25 gives IDF
    # log(1)=0 to every term appearing in exactly one doc, so all scores
    # are 0 and bm25_search (correctly) returns [].
    results = bm25_search("what is RBAC policy", chunks, top_k=5)
    assert len(results) > 0
    assert results[0].chunk_id == "c0"  # RBAC chunk should be first


def test_zero_score_chunks_excluded():
    chunks = make_chunks(["completely unrelated topic"])
    results = bm25_search("quantum physics nuclear reactor", chunks, top_k=5)
    # Zero-score results should be excluded
    for r in results:
        assert r.score > 0


def test_rbac_filter_uses_organization_and_custom_role_ids():
    qdrant_client = pytest.importorskip(
        "qdrant_client", reason="qdrant-client not installed"
    )
    with patch("retrieval.rbac_filter.get_client") as mock_client_fn:
        mock_client = MagicMock()
        mock_client_fn.return_value = mock_client
        mock_client.scroll.return_value = ([], None)

        from retrieval.rbac_filter import fetch_authorized_chunks

        rbac = RBACContext(
            org_id="org-1", workspace_id="ws-1",
            department_id="dept-1", role_id="role-manager",
            allowed_role_ids=["role-manager"],
        )
        fetch_authorized_chunks(rbac)

        call_kwargs = mock_client.scroll.call_args.kwargs
        conditions = call_kwargs["scroll_filter"].must
        fields = [c.key for c in conditions]
        assert "org_id" in fields
        assert "allowed_role_ids" in fields


def test_owner_filter_is_scoped_to_organization_only():
    pytest.importorskip("qdrant_client", reason="qdrant-client not installed")
    with patch("retrieval.rbac_filter.get_client") as mock_client_fn:
        mock_client = MagicMock()
        mock_client_fn.return_value = mock_client
        mock_client.scroll.return_value = ([], None)

        from retrieval.rbac_filter import fetch_authorized_chunks

        fetch_authorized_chunks(RBACContext(
            org_id="org-1",
            workspace_id="ws-1",
            department_id="dept-1",
            role_id="role-owner",
            is_owner=True,
            allowed_role_ids=[],
        ))

        conditions = mock_client.scroll.call_args.kwargs["scroll_filter"].must
        assert [condition.key for condition in conditions] == ["org_id"]
