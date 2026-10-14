from types import SimpleNamespace

from fastapi.testclient import TestClient

import main


def test_ask_reports_pipeline_stages_and_returns_cited_evidence(monkeypatch):
    reported_stages = []

    async def fake_report_progress(token, endpoint, **details):
        reported_stages.append(details['stage'])

    monkeypatch.setattr(main, 'report_progress', fake_report_progress)
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
                'role': 'Admin',
            },
            'token': 'test-token',
            'request_id': 'test-request-1',
        },
    )

    assert response.status_code == 200
    assert response.json()['sources'] == [{
        'id': 'chunk-1',
        'filename': 'guide.pdf',
        'page': 2,
        'excerpt': 'Follow the approved process.',
    }]
    assert reported_stages == [
        'Searching your authorized documents',
        'Ranking 1 relevant passages',
        'Drafting an answer from the selected passages',
        'Checking the answer and its source citations',
    ]