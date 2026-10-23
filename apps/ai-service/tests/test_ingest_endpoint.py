from types import SimpleNamespace

from fastapi.testclient import TestClient

import main


def test_ingest_reads_uploaded_pdf_bytes(monkeypatch):
    monkeypatch.setattr(main, 'AI_SERVICE_API_KEY', 'test-service-key-12345678901234567890')
    expected_bytes = b'%PDF-1.7 test document'
    parsed = {}
    reported_stages = []

    def fake_ingest_document(file_path, filename):
        with open(file_path, 'rb') as uploaded_file:
            parsed['bytes'] = uploaded_file.read()
        parsed['filename'] = filename
        from ingestion.schema import FileType

        return SimpleNamespace(
            filename=filename,
            file_type=FileType.PDF,
            pages=[SimpleNamespace(page_num=1)],
            is_scanned_or_empty=False,
        )

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
                '"department_id":"department-1","role_id":"role-admin",'
                '"allowed_role_ids":["role-admin"]}'
            ),
            'document_id': '8c91ea18-102d-4d4a-ad80-f2c71af8d84c',
            'token': 'test-token',
        },
        files={'file': ('report.pdf', expected_bytes, 'application/pdf')},
        headers={'x-ekip-service-key': 'test-service-key-12345678901234567890'},
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


def test_ingest_visual_indexes_scanned_pdf_even_when_ocr_found_text(monkeypatch):
    monkeypatch.setattr(main, 'AI_SERVICE_API_KEY', 'test-service-key-12345678901234567890')
    upload_bytes = b'%PDF-1.7 scanned document'
    visual_calls = []

    def fake_ingest_document(file_path, filename):
        from ingestion.schema import FileType

        return SimpleNamespace(
            filename=filename,
            file_type=FileType.PDF,
            pages=[SimpleNamespace(page_num=1, text='OCR extracted page text')],
            is_scanned_or_empty=False,
            has_scanned_pages=True,
        )

    class FakeVisualResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {'pages_upserted': 1}

    class FakeVisualClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, **kwargs):
            visual_calls.append((url, kwargs))
            return FakeVisualResponse()

    async def fake_report_progress(*args, **kwargs):
        return None

    monkeypatch.setattr(main, 'ingest_document', fake_ingest_document)
    monkeypatch.setattr(main.httpx, 'AsyncClient', lambda **kwargs: FakeVisualClient())
    monkeypatch.setattr(main, 'report_progress', fake_report_progress)
    monkeypatch.setattr(main, 'report_progress_sync', lambda *args, **kwargs: None)
    monkeypatch.setattr(
        main,
        'chunk_document',
        lambda result, document_id: [SimpleNamespace(document_id=document_id)],
    )
    monkeypatch.setattr(
        'embeddings.service.embed_and_upsert',
        lambda *args, **kwargs: 1,
    )

    response = TestClient(main.app).post(
        '/ingest',
        data={
            'rbac': (
                '{"org_id":"org-1","workspace_id":"workspace-1",'
                '"department_id":"department-1","role_id":"role-admin",'
                '"allowed_role_ids":["role-admin"]}'
            ),
            'document_id': '8c91ea18-102d-4d4a-ad80-f2c71af8d84c',
            'token': 'test-token',
        },
        files={'file': ('scan.pdf', upload_bytes, 'application/pdf')},
        headers={'x-ekip-service-key': 'test-service-key-12345678901234567890'},
    )

    assert response.status_code == 200
    assert len(visual_calls) == 1
    url, request = visual_calls[0]
    assert url.endswith('/visual/ingest')
    assert request['files']['file'][1] == upload_bytes
    assert response.json()['chunk_count'] == 1


def test_ingest_rejects_empty_content_when_visual_index_is_unavailable(monkeypatch):
    monkeypatch.setattr(main, 'AI_SERVICE_API_KEY', 'test-service-key-12345678901234567890')

    def empty_document(file_path, filename):
        from ingestion.schema import FileType

        return SimpleNamespace(
            filename=filename,
            file_type=FileType.TXT,
            pages=[],
            is_scanned_or_empty=True,
            warning='File is empty.',
        )

    async def fake_report_progress(*args, **kwargs):
        return None

    monkeypatch.setattr(
        main,
        'ingest_document',
        empty_document,
    )
    monkeypatch.setattr(main, 'report_progress', fake_report_progress)
    monkeypatch.setattr(main, 'chunk_document', lambda result, document_id: [])

    response = TestClient(main.app).post(
        '/ingest',
        data={
            'rbac': (
                '{"org_id":"org-1","workspace_id":"workspace-1",'
                '"department_id":"department-1","role_id":"role-admin",'
                '"allowed_role_ids":["role-admin"]}'
            ),
            'document_id': '8c91ea18-102d-4d4a-ad80-f2c71af8d84c',
            'token': 'test-token',
        },
        files={'file': ('empty.txt', b'', 'text/plain')},
        headers={'x-ekip-service-key': 'test-service-key-12345678901234567890'},
    )

    assert response.status_code == 422
    assert response.json()['detail'] == 'File is empty.'