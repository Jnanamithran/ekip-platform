"""
Tests for the OCR fallback applied to scanned / image-only PDFs.

A PDF page whose extracted text is below SCANNED_DOC_CHAR_THRESHOLD is first
passed through EasyOCR. When OCR returns usable text the page keeps that text
and remains eligible for visual indexing based on its original text layer.
When OCR is unavailable or fails, the document is also flagged as empty so it
can be routed to the ColPali visual pipeline.
"""

import sys
import types
from pathlib import Path

import pymupdf
import pytest

SVC_DIR = Path(__file__).resolve().parents[1]
if str(SVC_DIR) not in sys.path:
    sys.path.insert(0, str(SVC_DIR))

from ingestion.parsers import pdf_parser  # noqa: E402
from ingestion.parsers.pdf_parser import parse_pdf  # noqa: E402

OCR_TEXT = "Scanned document text extracted by OCR engine successfully"


# â”€â”€ fixtures / helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@pytest.fixture
def text_pdf(tmp_path):
    """A normal text-based PDF (no OCR should be needed)."""
    path = tmp_path / "text.pdf"
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 100), "This is a normal text based PDF page with plenty of words.")
    doc.save(path)
    doc.close()
    return path


@pytest.fixture
def image_only_pdf(tmp_path):
    """A page containing only an image and no text layer (simulates a scan)."""
    path = tmp_path / "image_only.pdf"
    doc = pymupdf.open()
    page = doc.new_page()
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 200))
    pix.set_rect(pix.irect, (255, 255, 255))
    page.insert_image(pymupdf.Rect(50, 50, 300, 300), pixmap=pix)
    doc.save(path)
    doc.close()
    return path


@pytest.fixture
def empty_pdf(tmp_path):
    """A PDF with a single blank page."""
    path = tmp_path / "empty.pdf"
    doc = pymupdf.open()
    doc.new_page()
    doc.save(path)
    doc.close()
    return path


class FakeEasyOCRReader:
    """Stand-in for easyocr.Reader that returns fixed text."""

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    def readtext(self, arr, detail=0):
        assert arr.ndim == 3, f"expected an HxWx3 image array, got shape {arr.shape}"
        assert arr.shape[2] == 3, f"expected 3 colour channels, got {arr.shape[2]}"
        assert arr.dtype.name == "uint8"
        return OCR_TEXT.split()


@pytest.fixture
def stub_easyocr(monkeypatch):
    """Install a fake `easyocr` module and reset the cached reader."""
    captured = {}

    def _reader_factory(langs, gpu=None, verbose=None):
        captured["langs"] = langs
        captured["gpu"] = gpu
        return FakeEasyOCRReader()

    module = types.ModuleType("easyocr")
    module.Reader = _reader_factory
    module.__version__ = "stub"
    monkeypatch.setitem(sys.modules, "easyocr", module)
    monkeypatch.setattr(pdf_parser, "_ocr_reader", None)
    yield captured
    monkeypatch.setattr(pdf_parser, "_ocr_reader", None)




# â”€â”€ normal text PDFs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def test_text_pdf_keeps_extracted_text_without_calling_ocr(text_pdf, monkeypatch):
    calls = []

    def _spy(path, page_num, doc=None):
        calls.append(page_num)
        return ""

    monkeypatch.setattr(pdf_parser, "try_ocr_page", _spy)

    result = parse_pdf(str(text_pdf), "text.pdf")

    assert calls == [], "OCR must not run for pages that already have a text layer"
    assert "normal text based PDF" in result.pages[0].text
    assert result.is_scanned_or_empty is False
    assert result.has_scanned_pages is False
    assert result.warning is None


# â”€â”€ OCR unavailable / failing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def test_scanned_pdf_falls_back_when_ocr_unavailable(image_only_pdf, monkeypatch):
    """easyocr is not installed -> OCR yields nothing, doc stays flagged."""

    def _no_ocr(path, page_num, doc=None):
        return ""

    monkeypatch.setattr(pdf_parser, "try_ocr_page", _no_ocr)

    result = parse_pdf(str(image_only_pdf), "image_only.pdf")

    assert result.pages[0].text == ""
    assert result.is_scanned_or_empty is True
    assert result.has_scanned_pages is True
    assert result.warning is not None
    assert "OCR" in result.warning


def test_ocr_failure_is_swallowed_and_does_not_raise(image_only_pdf, monkeypatch):
    def _boom(path, page_num, doc=None):
        raise RuntimeError("easyocr exploded")

    monkeypatch.setattr(pdf_parser, "try_ocr_page", _boom)

    try:
        result = parse_pdf(str(image_only_pdf), "image_only.pdf")
    except RuntimeError:
        pytest.fail("parse_pdf must not propagate OCR exceptions")

    assert result.is_scanned_or_empty is True
    assert result.has_scanned_pages is True
    assert result.warning is not None




# â”€â”€ OCR success â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def test_scanned_pdf_uses_ocr_text_when_available(image_only_pdf, stub_easyocr):
    result = parse_pdf(str(image_only_pdf), "image_only.pdf")

    assert result.pages[0].text == OCR_TEXT
    assert result.is_scanned_or_empty is False
    assert result.has_scanned_pages is True
    assert result.warning is None
    assert stub_easyocr["langs"] == ["en"]


def test_ocr_reader_is_cached_and_reused_across_pages(tmp_path, stub_easyocr):
    """The reader must be built once, not once per page."""
    path = tmp_path / "multi.pdf"
    doc = pymupdf.open()
    for _ in range(3):
        page = doc.new_page()
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 100, 100))
        pix.set_rect(pix.irect, (255, 255, 255))
        page.insert_image(pymupdf.Rect(10, 10, 90, 90), pixmap=pix)
    doc.save(path)
    doc.close()

    result = parse_pdf(str(path), "multi.pdf")

    assert len(result.pages) == 3
    assert pdf_parser._ocr_reader is not None, "reader should be cached after use"


def test_ocr_only_runs_for_pages_below_threshold(tmp_path, monkeypatch):
    """Pages with a solid text layer are skipped; sparse pages are OCR'd."""
    path = tmp_path / "mixed.pdf"
    doc = pymupdf.open()
    rich = doc.new_page()
    rich.insert_text((72, 100), "A page with a genuinely long text layer " * 5)
    sparse = doc.new_page()
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 100, 100))
    pix.set_rect(pix.irect, (255, 255, 255))
    sparse.insert_image(pymupdf.Rect(10, 10, 90, 90), pixmap=pix)
    doc.save(path)
    doc.close()

    attempted = []

    def _spy(path, page_num, doc=None):
        attempted.append(page_num)
        return "OCR TEXT " * 10

    monkeypatch.setattr(pdf_parser, "try_ocr_page", _spy)

    result = parse_pdf(str(path), "mixed.pdf")

    assert attempted == [2], "only the sparse page should be sent to OCR"
    assert "genuinely long text layer" in result.pages[0].text
    assert result.pages[1].text.startswith("OCR TEXT")
    assert result.has_scanned_pages is False


# â”€â”€ edge cases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def test_empty_pdf_is_flagged_and_does_not_crash(empty_pdf):
    result = parse_pdf(str(empty_pdf), "empty.pdf")

    assert result.total_pages == 1
    assert result.pages[0].text == ""
    assert result.is_scanned_or_empty is True
    assert result.has_scanned_pages is True
    assert result.warning is not None
    assert "OCR" in result.warning


def test_pixmap_conversion_handles_rgb_rgba_and_grayscale():
    rgb = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 10, 10))
    assert pdf_parser._pixmap_to_rgb_array(rgb).shape == (10, 10, 3)

    rgba = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 10, 10), True)
    assert rgba.n == 4
    assert pdf_parser._pixmap_to_rgb_array(rgba).shape == (10, 10, 3)

    gray = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 10, 10))
    assert pdf_parser._pixmap_to_rgb_array(gray).shape == (10, 10, 3)


def test_try_ocr_page_can_reuse_an_open_document(image_only_pdf):
    """When an open doc is supplied the file must not be re-opened."""
    with pymupdf.open(str(image_only_pdf)) as doc:
        assert pdf_parser._render_page_to_rgb(doc, 1).shape[2] == 3
        assert pdf_parser._render_page_to_rgb(doc, 1).ndim == 3

def test_try_ocr_page_returns_empty_string_when_easyocr_missing(image_only_pdf):
    """The real helper must degrade to '' when easyocr cannot be imported."""
    sys.modules.pop("easyocr", None)
    pdf_parser._ocr_reader = None
    assert pdf_parser.try_ocr_page(str(image_only_pdf), 1) == ""

@pytest.fixture(autouse=True)
def _reset_ocr_reader():
    """Never leak the cached reader between tests."""
    original = pdf_parser._ocr_reader
    pdf_parser._ocr_reader = None
    yield
    pdf_parser._ocr_reader = original
