"""Unit tests for the ingestion layer (Step 2).

Mocks nothing — ingestion is pure file parsing (PyMuPDF / python-docx /
openpyxl), but the blank-PDF test may trigger the EasyOCR fallback path.
That path swallows all exceptions and returns "", so this test runs fine
with or without easyocr installed.
"""

import os
import sys
from pathlib import Path

SVC_DIR = Path(__file__).resolve().parents[1]
if str(SVC_DIR) not in sys.path:
    sys.path.insert(0, str(SVC_DIR))

import pytest  # noqa: E402

from ingestion import ingest_document, UnsupportedFileTypeError  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def test_pdf_extracts_pages():
    result = ingest_document(f"{FIXTURES}/test.pdf", "test.pdf")
    assert result.total_pages > 0
    assert result.file_type.value == "pdf"
    assert not result.is_scanned_or_empty


def test_scanned_pdf_flagged(tmp_path):
    """A PDF with no text content should be flagged."""
    import fitz

    doc = fitz.open()
    doc.new_page()  # blank page — no text
    pdf_path = str(tmp_path / "blank.pdf")
    doc.save(pdf_path)
    doc.close()
    result = ingest_document(pdf_path, "blank.pdf")
    assert result.is_scanned_or_empty is True


def test_unsupported_type_raises(tmp_path):
    jpg_path = str(tmp_path / "test.jpg")
    with open(jpg_path, "wb") as f:
        f.write(b"fake image data")
    with pytest.raises(UnsupportedFileTypeError):
        ingest_document(jpg_path, "test.jpg")


def test_magic_byte_mismatch_raises(tmp_path):
    """A .txt file renamed to .pdf should be rejected."""
    fake_pdf = str(tmp_path / "fake.pdf")
    with open(fake_pdf, "w") as f:
        f.write("I am not a PDF")
    with pytest.raises(UnsupportedFileTypeError):
        ingest_document(fake_pdf, "fake.pdf")
