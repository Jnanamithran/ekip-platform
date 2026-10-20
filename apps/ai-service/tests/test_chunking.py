"""Unit tests for the chunking layer (Step 3).

Pure in-memory sliding-window logic — no external services involved.
"""

import sys
from pathlib import Path

SVC_DIR = Path(__file__).resolve().parents[1]
if str(SVC_DIR) not in sys.path:
    sys.path.insert(0, str(SVC_DIR))

from chunking import chunk_document, Chunk  # noqa: E402
from ingestion.schema import IngestResult, PageContent, FileType  # noqa: E402


def make_result(texts: list, is_scanned=False):
    pages = [PageContent(page_num=i + 1, text=t) for i, t in enumerate(texts)]
    return IngestResult(
        filename="test.pdf", file_type=FileType.PDF,
        pages=pages, is_scanned_or_empty=is_scanned
    )


def test_long_text_creates_multiple_chunks():
    long_text = " ".join([f"word{i}" for i in range(500)])
    result = make_result([long_text])
    chunks = chunk_document(result, "doc-1")
    assert len(chunks) > 1


def test_chunks_have_40_word_overlap():
    long_text = " ".join([f"word{i}" for i in range(500)])
    result = make_result([long_text])
    chunks = chunk_document(result, "doc-1")
    for i in range(len(chunks) - 1):
        words_a = set(chunks[i].text.split())
        words_b = set(chunks[i + 1].text.split())
        overlap = len(words_a & words_b)
        assert overlap >= 38  # ~40 words overlap (allow small variance)


def test_page_boundary_never_crossed():
    result = make_result(["Page one text.", "Page two text."])
    chunks = chunk_document(result, "doc-1")
    for chunk in chunks:
        assert chunk.page_num in [1, 2]
        # Verify no chunk contains text from both pages
        if "Page one" in chunk.text:
            assert "Page two" not in chunk.text


def test_scanned_doc_zero_chunks():
    result = make_result(["tiny"], is_scanned=True)
    chunks = chunk_document(result, "doc-1")
    assert chunks == []
