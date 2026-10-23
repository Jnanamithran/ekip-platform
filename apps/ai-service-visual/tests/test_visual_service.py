import json
from pathlib import Path
from uuid import uuid4

import pymupdf
import pytest
from fastapi.testclient import TestClient
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct

import main as visual_service
from visual import colpali_embedder


SERVICE_KEY = "visual-service-test-key-that-is-long-enough"
AUTH_HEADERS = {"x-ekip-service-key": SERVICE_KEY}
SEARCH_REQUEST = {
    "query": "annual revenue",
    "org_id": "org-1",
    "workspace_id": "workspace-1",
    "department_id": "department-1",
    "role_id": "role-1",
}
RBAC_INFO = {
    "org_id": "org-1",
    "workspace_id": "workspace-1",
    "department_id": "department-1",
    "allowed_role_ids": ["role-1"],
    "uploaded_by": "user-1",
}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(visual_service, "AI_SERVICE_API_KEY", SERVICE_KEY)
    return TestClient(visual_service.app)


@pytest.mark.parametrize(
    ("method", "path", "kwargs"),
    [
        ("post", "/visual/search", {"json": SEARCH_REQUEST}),
        ("post", "/visual/ask", {"json": {**SEARCH_REQUEST, "question": "What is revenue?"}}),
        (
            "post",
            "/visual/ingest",
            {
                "data": {
                    "rbac": json.dumps(RBAC_INFO),
                    "document_id": str(uuid4()),
                },
                "files": {"file": ("scan.pdf", b"pdf", "application/pdf")},
            },
        ),
        ("delete", f"/visual/document/{uuid4()}", {}),
    ],
)
def test_visual_endpoints_require_service_key(client, method, path, kwargs):
    response = getattr(client, method)(path, **kwargs)

    assert response.status_code == 401


def test_authentication_is_unavailable_when_service_key_is_not_configured(
    client, monkeypatch
):
    monkeypatch.setattr(visual_service, "AI_SERVICE_API_KEY", "")

    response = client.post("/visual/search", json=SEARCH_REQUEST, headers=AUTH_HEADERS)

    assert response.status_code == 503
    assert response.json()["detail"] == "Visual service authentication is not configured"


def test_health_is_public(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["service"] == "ekip-visual-ai"


def test_search_returns_results_and_forwards_rbac(client, monkeypatch):
    result = {
        "document_id": "doc-1",
        "filename": "report.pdf",
        "page_num": 2,
        "image_path": "report_page2.jpg",
        "score": 0.91,
    }
    calls = []

    def fake_search_visual(**kwargs):
        calls.append(kwargs)
        return [result]

    monkeypatch.setattr(visual_service, "search_visual", fake_search_visual)
    response = client.post(
        "/visual/search",
        json={**SEARCH_REQUEST, "department_ids": ["department-2"], "top_k": 1},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    assert response.json() == {"results": [result], "query": "annual revenue"}
    assert calls == [
        {
            "query": "annual revenue",
            "rbac": {
                "org_id": "org-1",
                "workspace_id": "workspace-1",
                "department_id": "department-1",
                "department_ids": ["department-2"],
                "role_id": "role-1",
                "is_owner": False,
            },
            "top_k": 1,
        }
    ]


def test_search_rejects_invalid_request(client):
    response = client.post(
        "/visual/search", json={"query": "annual revenue"}, headers=AUTH_HEADERS
    )

    assert response.status_code == 422


def test_ask_returns_empty_answer_when_no_accessible_pages_exist(
    client, monkeypatch
):
    calls = []
    monkeypatch.setattr(
        visual_service,
        "search_visual",
        lambda **kwargs: calls.append(kwargs) or [],
    )
    monkeypatch.setattr(
        visual_service,
        "answer_from_images",
        lambda **kwargs: pytest.fail("generator must not run without retrieved pages"),
    )

    response = client.post(
        "/visual/ask",
        json={**SEARCH_REQUEST, "question": "What is revenue?"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    assert response.json()["citations"] == []
    assert response.json()["answer"] == (
        "No relevant visual content found in your accessible documents."
    )
    assert calls[0]["rbac"]["department_ids"] == ["department-1"]


def test_ask_uses_retrieved_images_and_returns_citations(
    client, monkeypatch, tmp_path
):
    image_path = tmp_path / "page.png"
    from PIL import Image

    Image.new("RGB", (8, 8), color="white").save(image_path)
    monkeypatch.setattr(
        visual_service,
        "search_visual",
        lambda **kwargs: [
            {
                "document_id": "doc-1",
                "filename": "report.pdf",
                "page_num": 3,
                "image_path": str(image_path),
                "score": 0.9,
            }
        ],
    )
    generated = []

    def fake_answer(**kwargs):
        generated.append(kwargs)
        return {
            "answer": "Revenue grew.",
            "model": "test-model",
            "citations": [
                {
                    "filename": "report.pdf",
                    "page_num": 3,
                    "document_id": "doc-1",
                    "text": "[Visual content — page 3 of report.pdf]",
                }
            ],
        }

    monkeypatch.setattr(visual_service, "answer_from_images", fake_answer)
    response = client.post(
        "/visual/ask",
        json={**SEARCH_REQUEST, "question": "What happened to revenue?"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    assert response.json()["answer"] == "Revenue grew."
    assert response.json()["citations"][0]["document_id"] == "doc-1"
    assert response.json()["pipeline"] == "visual"
    assert len(generated) == 1
    assert generated[0]["question"] == "What happened to revenue?"
    assert generated[0]["filenames"] == ["report.pdf"]


def test_ask_does_not_generate_when_retrieved_images_cannot_be_opened(
    client, monkeypatch
):
    monkeypatch.setattr(
        visual_service,
        "search_visual",
        lambda **kwargs: [
            {
                "document_id": "doc-1",
                "filename": "missing.pdf",
                "page_num": 1,
                "image_path": "does-not-exist.png",
                "score": 0.9,
            }
        ],
    )
    monkeypatch.setattr(
        visual_service,
        "answer_from_images",
        lambda **kwargs: pytest.fail("generator must not run without loaded images"),
    )

    response = client.post(
        "/visual/ask",
        json={**SEARCH_REQUEST, "question": "What is shown?"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    assert response.json()["citations"] == []
    assert response.json()["answer"] == (
        "Found matching pages but could not load their images."
    )


def test_ingest_renders_pdf_and_cleans_temporary_upload(
    client, monkeypatch
):
    document = pymupdf.open()
    document.new_page()
    pdf_bytes = document.tobytes()
    document.close()
    captured = {}

    def fake_embed(**kwargs):
        captured.update(kwargs)
        assert Path(kwargs["pdf_path"]).exists()
        return 1

    monkeypatch.setattr(visual_service, "embed_and_upsert_visual", fake_embed)
    document_id = str(uuid4())
    response = client.post(
        "/visual/ingest",
        data={"rbac": json.dumps(RBAC_INFO), "document_id": document_id},
        files={"file": ("C:\\uploads\\scan.pdf", pdf_bytes, "application/pdf")},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    assert response.json()["document_id"] == document_id
    assert response.json()["filename"] == "scan.pdf"
    assert response.json()["pages_upserted"] == 1
    assert captured["filename"] == "scan.pdf"
    assert captured["rbac"] == RBAC_INFO
    assert not Path(captured["pdf_path"]).exists()


@pytest.mark.parametrize(
    ("rbac", "document_id"),
    [
        ("not-json", str(uuid4())),
        (json.dumps(RBAC_INFO), "not-a-uuid"),
    ],
)
def test_ingest_rejects_invalid_rbac_or_document_id(
    client, monkeypatch, rbac, document_id
):
    monkeypatch.setattr(
        visual_service,
        "embed_and_upsert_visual",
        lambda **kwargs: pytest.fail("invalid request must not be embedded"),
    )
    document = pymupdf.open()
    document.new_page()
    pdf_bytes = document.tobytes()
    document.close()

    response = client.post(
        "/visual/ingest",
        data={"rbac": rbac, "document_id": document_id},
        files={"file": ("scan.pdf", pdf_bytes, "application/pdf")},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 422


def test_delete_removes_document_pages(client, monkeypatch):
    calls = []
    monkeypatch.setattr(
        visual_service,
        "delete_visual_document",
        lambda document_id: calls.append(document_id) or 2,
    )
    document_id = str(uuid4())

    response = client.delete(
        f"/visual/document/{document_id}", headers=AUTH_HEADERS
    )

    assert response.status_code == 200
    assert response.json()["deleted"] == 2
    assert calls == [document_id]


@pytest.mark.parametrize(
    ("is_owner", "department_ids", "expected_keys"),
    [
        (
            False,
            ["department-1", "department-2"],
            {"org_id", "workspace_id", "allowed_role_ids", "department_id"},
        ),
        (True, [], {"org_id", "workspace_id"}),
    ],
)
def test_qdrant_search_applies_rbac_filter_before_query(
    monkeypatch, is_owner, department_ids, expected_keys
):
    class FakeClient:
        def query_points(self, **kwargs):
            self.arguments = kwargs
            return type("QueryResponse", (), {"points": []})()

    fake_client = FakeClient()
    monkeypatch.setattr(colpali_embedder, "get_qdrant", lambda: fake_client)
    monkeypatch.setattr(colpali_embedder, "embed_query", lambda query: [0.1] * 128)
    rbac = {
        "org_id": "org-1",
        "workspace_id": "workspace-1",
        "department_id": "department-1",
        "department_ids": department_ids,
        "role_id": "role-1",
        "is_owner": is_owner,
    }

    assert colpali_embedder.search_visual("annual revenue", rbac, top_k=3) == []

    arguments = fake_client.arguments
    assert arguments["limit"] == 3
    assert arguments["query"] == [0.1] * 128
    conditions = arguments["query_filter"].must
    assert {condition.key for condition in conditions} == expected_keys
    condition_map = {condition.key: condition for condition in conditions}
    assert condition_map["org_id"].match.value == "org-1"
    assert condition_map["workspace_id"].match.value == "workspace-1"
    if not is_owner:
        assert condition_map["allowed_role_ids"].match.value == "role-1"
        assert condition_map["department_id"].match.any == department_ids


def test_qdrant_query_points_enforces_rbac_with_in_memory_client(monkeypatch):
    client = QdrantClient(":memory:")
    vector = [1.0] + [0.0] * 127
    monkeypatch.setattr(colpali_embedder, "get_qdrant", lambda: client)
    monkeypatch.setattr(colpali_embedder, "embed_query", lambda query: vector)

    try:
        colpali_embedder.ensure_visual_collection()
        client.upsert(
            collection_name=colpali_embedder.VISUAL_COLLECTION,
            points=[
                PointStruct(
                    id=str(uuid4()),
                    vector=vector,
                    payload={
                        "document_id": "authorized",
                        "filename": "allowed.pdf",
                        "page_num": 1,
                        "image_path": "allowed.jpg",
                        "org_id": "org-1",
                        "workspace_id": "workspace-1",
                        "department_id": "department-2",
                        "allowed_role_ids": ["role-1"],
                    },
                ),
                PointStruct(
                    id=str(uuid4()),
                    vector=vector,
                    payload={
                        "document_id": "wrong-role",
                        "filename": "private.pdf",
                        "page_num": 1,
                        "image_path": "private.jpg",
                        "org_id": "org-1",
                        "workspace_id": "workspace-1",
                        "department_id": "department-2",
                        "allowed_role_ids": ["role-2"],
                    },
                ),
                PointStruct(
                    id=str(uuid4()),
                    vector=vector,
                    payload={
                        "document_id": "wrong-department",
                        "filename": "other.pdf",
                        "page_num": 1,
                        "image_path": "other.jpg",
                        "org_id": "org-1",
                        "workspace_id": "workspace-1",
                        "department_id": "department-3",
                        "allowed_role_ids": ["role-1"],
                    },
                ),
            ],
        )

        results = colpali_embedder.search_visual(
            "annual revenue",
            {
                "org_id": "org-1",
                "workspace_id": "workspace-1",
                "department_id": "department-1",
                "department_ids": ["department-1", "department-2"],
                "role_id": "role-1",
                "is_owner": False,
            },
        )

        assert [result["document_id"] for result in results] == ["authorized"]
    finally:
        client.close()
