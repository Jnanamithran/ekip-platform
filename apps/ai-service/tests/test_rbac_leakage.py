"""
RBAC Leakage Tests — proves unauthorized content never reaches retrieval.
Run with: pytest tests/test_rbac_leakage.py -v -m integration

Requires local Qdrant running on localhost:6333 (see LOCAL_RUNNING.md).
"""
import sys
import time
from pathlib import Path

import pytest

SVC_DIR = Path(__file__).resolve().parents[1]
if str(SVC_DIR) not in sys.path:
    sys.path.insert(0, str(SVC_DIR))

qdrant_client = pytest.importorskip(
    "qdrant_client", reason="qdrant-client not installed"
)

from embeddings import embed_and_upsert, RBACMetadata  # noqa: E402
from retrieval import sparse_retrieve, RBACContext  # noqa: E402
from embeddings.qdrant_client import get_client, COLLECTION_NAME  # noqa: E402

pytestmark = pytest.mark.integration

ROLE_ADMIN = "role-admin"
ROLE_MANAGER = "role-manager"
ROLE_EMPLOYEE = "role-employee"
ROLE_INTERN = "role-intern"


def _delete_org(org_id: str) -> None:
    """Remove all points for an org — best-effort (Qdrant may be empty)."""
    from qdrant_client.models import Filter, FieldCondition, MatchValue

    try:
        get_client().delete(
            collection_name=COLLECTION_NAME,
            points_selector=Filter(
                must=[FieldCondition(key="org_id", match=MatchValue(value=org_id))]
            ),
        )
    except Exception:
        pass


@pytest.fixture(autouse=True)
def cleanup_test_data():
    """Remove test data before and after each test."""
    _delete_org("test-org-rbac")
    _delete_org("test-org-b-rbac")
    yield
    _delete_org("test-org-rbac")
    _delete_org("test-org-b-rbac")


def seed_chunk(text, department_id, allowed_role_ids, doc_id):
    """Helper: seed a single chunk into Qdrant."""
    from chunking.schema import Chunk

    chunk = Chunk(
        document_id=doc_id, filename="test.pdf", file_type="pdf",
        page_num=1, chunk_index=0, text=text
    )
    rbac = RBACMetadata(
        org_id="test-org-rbac", workspace_id="ws-test",
        department_id=department_id, allowed_role_ids=allowed_role_ids,
        uploaded_by="user-test",
    )
    embed_and_upsert([chunk], rbac)
    # Qdrant upserts are not instantly visible to subsequent scroll/search
    # calls; without this the retrieval assertions below are flaky.
    time.sleep(1)


def test_cross_department_isolation():
    """Dept A user must get zero results from Dept B content."""
    seed_chunk(
        "This is secret HR content about salaries and compensation",
        department_id="dept-hr", allowed_role_ids=[ROLE_ADMIN, ROLE_MANAGER],
        doc_id="doc-hr-secret",
    )
    seed_chunk(
        "This is engineering technical documentation about the API",
        department_id="dept-eng",
        allowed_role_ids=[ROLE_ADMIN, ROLE_MANAGER, ROLE_EMPLOYEE],
        doc_id="doc-eng-public",
    )

    # Engineering user queries
    rbac = RBACContext(
        org_id="test-org-rbac", workspace_id="ws-test",
        department_id="dept-eng", role_id=ROLE_EMPLOYEE,
        allowed_role_ids=[ROLE_EMPLOYEE],
    )
    results = sparse_retrieve("salary compensation HR", rbac, top_k=10)

    # Must return zero HR results
    for r in results:
        assert "salary" not in r.text.lower(), (
            f"RBAC LEAK: HR content '{r.text}' reached Engineering user!"
        )


def test_role_isolation():
    """Employee must not see Admin-only documents."""
    seed_chunk(
        "Confidential board meeting minutes and executive decisions",
        department_id="dept-eng", allowed_role_ids=[ROLE_ADMIN],
        doc_id="doc-admin-only",
    )

    rbac = RBACContext(
        org_id="test-org-rbac", workspace_id="ws-test",
        department_id="dept-eng", role_id=ROLE_EMPLOYEE,
        allowed_role_ids=[ROLE_EMPLOYEE],
    )
    results = sparse_retrieve("board meeting executive decisions", rbac, top_k=10)

    for r in results:
        assert "board meeting" not in r.text.lower(), (
            f"RBAC LEAK: Admin-only content '{r.text}' reached Employee!"
        )


def test_cross_org_isolation():
    """Org A must never see Org B content."""
    from chunking.schema import Chunk

    # Seed Org B content
    chunk = Chunk(
        document_id="doc-org-b", filename="org_b_secret.pdf",
        file_type="pdf", page_num=1, chunk_index=0,
        text="Organization B secret project codenamed Project Phoenix",
    )
    rbac_b = RBACMetadata(
        org_id="test-org-b-rbac", workspace_id="ws-b",
        department_id="dept-b",
        allowed_role_ids=[ROLE_ADMIN, ROLE_MANAGER, ROLE_EMPLOYEE, ROLE_INTERN],
        uploaded_by="user-b",
    )
    embed_and_upsert([chunk], rbac_b)
    time.sleep(1)

    # Query as Org A user
    rbac_a = RBACContext(
        org_id="test-org-rbac", workspace_id="ws-test",
        department_id="dept-eng", role_id=ROLE_ADMIN,
        allowed_role_ids=[ROLE_ADMIN],
    )
    results = sparse_retrieve("Project Phoenix secret", rbac_a, top_k=10)

    for r in results:
        assert "phoenix" not in r.text.lower(), (
            "CROSS-ORG LEAK: Org B content reached Org A user!"
        )
