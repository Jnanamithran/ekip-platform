"""
PDF parser using PyMuPDF (pymupdf).
Extracts text per page and flags documents that are likely scanned
(image-only, no real text layer) so they don't silently produce empty chunks.
"""

import pymupdf  # PyMuPDF
import numpy as np
from ..schema import IngestResult, PageContent, FileType

# If average extracted chars/page falls below this, we assume it's a scan.
# Real text-based PDFs almost always exceed this by a wide margin.
SCANNED_DOC_CHAR_THRESHOLD = 20

# ── EasyOCR fallback (lazy singleton) ────────────────────────────────────────
# easyocr.Reader loads ~100MB of detection + recognition model weights, so it
# is created once and reused across pages rather than re-instantiated per page.
_ocr_reader = None


def _get_ocr_reader(gpu: bool | None = None):
    """Lazy-load a single EasyOCR reader, reusing it across calls."""
    global _ocr_reader
    if _ocr_reader is None:
        import easyocr
        # Auto-detect GPU; fall back to CPU when CUDA is unavailable.
        if gpu is None:
            try:
                import torch

                gpu = bool(torch.cuda.is_available())
            except Exception:
                gpu = False
        _ocr_reader = easyocr.Reader(["en"], gpu=gpu, verbose=False)
    return _ocr_reader


def _pixmap_to_rgb_array(pix) -> "np.ndarray":
    """
    Convert a PyMuPDF Pixmap into a contiguous HxWx3 uint8 RGB array.

    PyMuPDF pixmaps may be RGB (n=3), RGBA (n=4) or grayscale (n=1), so the
    channel count is inspected rather than assumed.
    """
    if pix.n == 4:  # RGBA -> drop alpha
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
            pix.height, pix.width, 4
        )
        return np.ascontiguousarray(arr[:, :, :3])
    if pix.n == 1:  # grayscale -> replicate to 3 channels
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
            pix.height, pix.width
        )
        return np.ascontiguousarray(np.stack([arr] * 3, axis=-1))
    # n == 3 -> already RGB
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(
        pix.height, pix.width, 3
    )


def _render_page_to_rgb(doc, page_num: int) -> "np.ndarray":
    """Render a single page of an open document to a HxWx3 uint8 RGB array."""
    page = doc[page_num - 1]
    pix = page.get_pixmap(dpi=200)
    return _pixmap_to_rgb_array(pix)


def try_ocr_page(pdf_path: str, page_num: int, doc=None) -> str:
    """
    Try EasyOCR on a single PDF page.
    Returns extracted text or empty string if OCR fails / is unavailable.

    `doc` may be an already-open PyMuPDF document; when supplied the file is
    not re-opened, which avoids repeated I/O across multi-page documents.
    """
    try:
        if doc is not None:
            arr = _render_page_to_rgb(doc, page_num)
        else:
            with pymupdf.open(pdf_path) as own_doc:
                arr = _render_page_to_rgb(own_doc, page_num)

        reader = _get_ocr_reader()
        results = reader.readtext(arr, detail=0)
        return " ".join(results)
    except Exception:
        return ""


def parse_pdf(file_path: str, filename: str) -> IngestResult:
    doc = pymupdf.open(file_path)
    pages = []
    native_text_chars = 0

    for page_num, page in enumerate(doc, start=1):
        text = page.get_text("text").strip()
        native_text_chars += len(text)
        if len(text) < SCANNED_DOC_CHAR_THRESHOLD:
            # Try OCR before giving up on this page. OCR must never break
            # ingestion, so any failure falls back to the original (empty) text.
            try:
                ocr_text = try_ocr_page(file_path, page_num, doc=doc)
            except Exception:
                ocr_text = ""
            if len(ocr_text) > SCANNED_DOC_CHAR_THRESHOLD:
                text = ocr_text  # OCR succeeded — use OCR text instead
        pages.append(PageContent(page_num=page_num, text=text))

    doc.close()

    total_chars = sum(p.char_count for p in pages)
    avg_chars_per_page = total_chars / len(pages) if pages else 0
    is_scanned = avg_chars_per_page < SCANNED_DOC_CHAR_THRESHOLD
    avg_native_chars_per_page = native_text_chars / len(pages) if pages else 0
    has_scanned_pages = avg_native_chars_per_page < SCANNED_DOC_CHAR_THRESHOLD

    warning = None
    if is_scanned:
        warning = (
            f"Low text yield after OCR attempt ({avg_chars_per_page:.1f} chars/page avg). "
            "Likely a scanned or image-only PDF — routing to ColPali visual pipeline."
        )

    return IngestResult(
        filename=filename,
        file_type=FileType.PDF,
        pages=pages,
        is_scanned_or_empty=is_scanned,
        has_scanned_pages=has_scanned_pages,
        warning=warning,
    )
