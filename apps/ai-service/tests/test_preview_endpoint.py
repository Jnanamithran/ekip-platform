from types import SimpleNamespace

from fastapi.testclient import TestClient

import main


def test_preview_returns_extracted_document_pages(monkeypatch):
    monkeypatch.setattr(main, 'AI_SERVICE_API_KEY', 'test-service-key-12345678901234567890')
    expected_bytes = b'Preview text'
    parsed = {}

    def fake_ingest_document(file_path, filename):
        with open(file_path, 'rb') as uploaded_file:
            parsed['bytes'] = uploaded_file.read()
        parsed['filename'] = filename
        from ingestion.schema import FileType

        return SimpleNamespace(
            filename=filename,
            file_type=FileType.TXT,
            pages=[SimpleNamespace(page_num=1, text='Preview text')],
            warning=None,
        )

    monkeypatch.setattr(main, 'ingest_document', fake_ingest_document)

    response = TestClient(main.app).post(
        '/preview',
        files={'file': ('readme.txt', expected_bytes, 'text/plain')},
        headers={'x-ekip-service-key': 'test-service-key-12345678901234567890'},
    )

    assert response.status_code == 200
    assert parsed == {'bytes': expected_bytes, 'filename': 'readme.txt'}
    assert response.json() == {
        'filename': 'readme.txt',
        'file_type': 'txt',
        'pages': [{'page_num': 1, 'text': 'Preview text'}],
        'warning': None,
    }


def test_preview_rejects_unsupported_file_types(monkeypatch):
    monkeypatch.setattr(main, 'AI_SERVICE_API_KEY', 'test-service-key-12345678901234567890')
    response = TestClient(main.app).post(
        '/preview',
        files={'file': ('report.pdf', b'%PDF-test', 'application/pdf')},
        headers={'x-ekip-service-key': 'test-service-key-12345678901234567890'},
    )

    assert response.status_code == 415
