from types import SimpleNamespace

from fastapi.testclient import TestClient

import main


def test_ingest_reads_uploaded_pdf_bytes(monkeypatch):
    expected_bytes = b'%PDF-1.7 test document'
    parsed = {}
    reported_stages = []

    def fake_ingest_document(file_path, filename):
        with open(file_path, 'rb') as uploaded_file:
            parsed['bytes'] = uploaded_file.read()
        parsed['filename'] = filename
        return SimpleNamespace(filename=filename, pages=[SimpleNamespace(page_num=1)])

    async def fake_report_progress(token, endpoint, **details):
        reported_stages.append(details)

    def fake_embed_and_upsert(chunks, metadata, progress_callback=None):
        if progress_callback:
            progress_callback('Writing chunks to the searchable index')
        return len(chunks)

    monkeypatch.setattr(main, 'ingest_document', fake_ingest_document)
    monkeypatch.setattr(main, 'report_progress', fake_report_progress)
    monkeypatch.setattr(
        main,
        'report_progress_sync',
        lambda token, endpoint, **details: reported_stages.append(details),
    )
    monkeypatch.setattr(
        main,
        'chunk_document',
        lambda result, document_id: [SimpleNamespace(document_id=document_id)],
    )
    monkeypatch.setattr(
        'embeddings.service.embed_and_upsert',
        fake_embed_and_upsert,
    )

    response = TestClient(main.app).post(
        '/ingest',
        data={
            'rbac': (
                '{"org_id":"org-1","workspace_id":"workspace-1",'
                '"department_id":"department-1","role":"Admin"}'
            ),
            'document_id': '8c91ea18-102d-4d4a-ad80-f2c71af8d84c',
            'token': 'test-token',
        },
        files={'file': ('report.pdf', expected_bytes, 'application/pdf')},
    )

    assert response.status_code == 200
    assert parsed == {'bytes': expected_bytes, 'filename': 'report.pdf'}
    assert response.json()['filename'] == 'report.pdf'
    assert response.json()['document_id'] == '8c91ea18-102d-4d4a-ad80-f2c71af8d84c'
    assert response.json()['chunk_count'] == 1
    assert [stage['stage'] for stage in reported_stages] == [
        'Saving uploaded file',
        'Parsing document pages',
        'Parsed 1 page(s)',
        'Splitting pages into searchable chunks',
        'Created 1 chunk(s)',
        'Generating embeddings for 1 chunk(s)',
        'Writing chunks to the searchable index',
    ]