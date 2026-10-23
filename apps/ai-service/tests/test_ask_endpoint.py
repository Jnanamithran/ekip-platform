from types import SimpleNamespace

import httpx
import pytest
from qdrant_client.http.exceptions import UnexpectedResponse
from fastapi.testclient import TestClient

import main


def test_missing_visual_collection_uses_text_pipeline(monkeypatch):
    def missing_visual_collection(**kwargs):
        raise UnexpectedResponse(
            status_code=404,
            reason_phrase='Not Found',
            content=b'Collection does not exist',
            headers=httpx.Headers(),
        )

    monkeypatch.setattr(
        main,
        'get_client',
        lambda: SimpleNamespace(scroll=missing_visual_collection),
    )

    assert main.has_visual_docs({
        'org_id': 'org-1',
        'workspace_id': 'workspace-1',
        'department_id': 'department-1',
        'role_id': 'role-admin',
        'is_owner': False,
    }) is False


def test_unexpected_visual_collection_error_is_not_swallowed(monkeypatch):
    def qdrant_unavailable(**kwargs):
        raise UnexpectedResponse(
            status_code=503,
            reason_phrase='Service Unavailable',
            content=b'Qdrant unavailable',
            headers=httpx.Headers(),
        )

    monkeypatch.setattr(
        main,
        'get_client',
        lambda: SimpleNamespace(scroll=qdrant_unavailable),
    )

    with pytest.raises(UnexpectedResponse):
        main.has_visual_docs({
            'org_id': 'org-1',
            'workspace_id': 'workspace-1',
            'department_id': 'department-1',
            'role_id': 'role-admin',
            'is_owner': False,
        })


def test_ask_reports_pipeline_stages_and_returns_cited_evidence(monkeypatch):
    monkeypatch.setattr(main, 'AI_SERVICE_API_KEY', 'test-service-key-12345678901234567890')
    reported_stages = []

    async def fake_report_progress(token, endpoint, **details):
        reported_stages.append(details['stage'])

    monkeypatch.setattr(main, 'report_progress', fake_report_progress)
    monkeypatch.setattr(main, 'has_visual_docs', lambda rbac_dict: False)
    monkeypatch.setattr(main, 'hybrid_retrieve', lambda query, rbac, top_k: ['candidate'])
    monkeypatch.setattr(main, 'rerank', lambda query, chunks, top_n: ['selected'])
    monkeypatch.setattr(main, 'generate_answer', lambda query, chunks: 'draft')
    monkeypatch.setattr(
        main,
        'extract_citations',
        lambda result, query: SimpleNamespace(
            answer='Use the approved process.',
            citations=[
                SimpleNamespace(
                    chunk_id='chunk-1',
                    document_id='doc-1',
                    filename='guide.pdf',
                    page_num=2,
                    chunk_text='Follow the approved process.',
                )
            ],
            model='test-model',
            has_answer=True,
        ),
    )

    response = TestClient(main.app).post(
        '/ask',
        json={
            'query': 'What process should I use?',
            'rbac': {
                'org_id': 'org-1',
                'workspace_id': 'workspace-1',
                'department_id': 'department-1',
                'role_id': 'role-admin',
                'is_owner': False,
            },
            'token': 'test-token',
            'request_id': 'test-request-1',
        },
        headers={'x-ekip-service-key': 'test-service-key-12345678901234567890'},
    )

    assert response.status_code == 200
    assert response.json()['sources'] == [{
        'id': 'chunk-1',
        'document_id': 'doc-1',
        'filename': 'guide.pdf',
        'page': 2,
        'excerpt': 'Follow the approved process.',
        'type': 'text',
    }]
    assert reported_stages == [
        'Searching your authorized documents',
        'Ranking 1 relevant passages',
        'Drafting an answer from the selected passages',
        'Checking the answer and its source citations',
    ]


def test_visual_timeout_does_not_return_a_no_evidence_answer(monkeypatch):
    monkeypatch.setattr(main, 'AI_SERVICE_API_KEY', 'test-service-key-12345678901234567890')
    monkeypatch.setattr(main, 'has_visual_docs', lambda rbac_dict: True)

    async def fake_text_pipeline(*args):
        return {
            'answer': "I couldn't find this information in the documents you have permission to access.",
            'sources': [],
            'model': 'text-model',
            'has_answer': False,
            'pipeline': 'text',
        }

    async def timed_out_visual_pipeline(*args):
        raise httpx.ReadTimeout('visual model is still loading')

    monkeypatch.setattr(main, 'run_text_pipeline', fake_text_pipeline)
    monkeypatch.setattr(main, 'run_visual_pipeline', timed_out_visual_pipeline)

    response = TestClient(main.app).post(
        '/ask',
        json={
            'query': 'Which month had the maximum revenue?',
            'rbac': {
                'org_id': 'org-1',
                'workspace_id': 'workspace-1',
                'department_id': 'department-1',
                'role_id': 'role-admin',
            },
            'token': 'test-token',
            'request_id': 'test-visual-timeout',
        },
        headers={'x-ekip-service-key': 'test-service-key-12345678901234567890'},
    )

    assert response.status_code == 504
    assert 'Visual answering timed out' in response.json()['detail']


def test_text_answer_is_returned_when_visual_pipeline_fails(monkeypatch):
    monkeypatch.setattr(main, 'AI_SERVICE_API_KEY', 'test-service-key-12345678901234567890')
    monkeypatch.setattr(main, 'has_visual_docs', lambda rbac_dict: True)

    async def fake_text_pipeline(*args):
        return {
            'answer': 'Revenue peaked in July.',
            'sources': [{
                'id': 'chunk-1',
                'document_id': 'doc-1',
                'filename': 'revenue.pdf',
                'page': 1,
                'excerpt': 'July revenue was the highest.',
                'type': 'text',
            }],
            'model': 'text-model',
            'has_answer': True,
            'pipeline': 'text',
        }

    async def failed_visual_pipeline(*args):
        raise httpx.ReadTimeout('visual model is still loading')

    monkeypatch.setattr(main, 'run_text_pipeline', fake_text_pipeline)
    monkeypatch.setattr(main, 'run_visual_pipeline', failed_visual_pipeline)

    response = TestClient(main.app).post(
        '/ask',
        json={
            'query': 'Which month had the maximum revenue?',
            'rbac': {
                'org_id': 'org-1',
                'workspace_id': 'workspace-1',
                'department_id': 'department-1',
                'role_id': 'role-admin',
            },
            'token': 'test-token',
            'request_id': 'test-visual-timeout-with-text-evidence',
        },
        headers={'x-ekip-service-key': 'test-service-key-12345678901234567890'},
    )

    assert response.status_code == 200
    assert response.json()['answer'] == 'Revenue peaked in July.'
    assert response.json()['pipeline'] == 'text'


def test_ask_rejects_requests_without_backend_service_key(monkeypatch):
    monkeypatch.setattr(main, 'AI_SERVICE_API_KEY', 'test-service-key-12345678901234567890')

    response = TestClient(main.app).post(
        '/ask',
        json={
            'query': 'What does the document say?',
            'rbac': {
                'org_id': 'org-1',
                'workspace_id': 'workspace-1',
                'department_id': 'department-1',
                'role_id': 'role-admin',
            },
            'token': 'test-token',
            'request_id': 'test-request-unauthorized',
        },
    )

    assert response.status_code == 401