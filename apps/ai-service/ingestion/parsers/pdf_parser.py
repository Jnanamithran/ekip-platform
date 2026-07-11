"""
PDF parser using PyMuPDF (fitz).
Extracts text per page and flags documents that are likely scanned
(image-only, no real text layer) so they don't silently produce empty chunks.
"""

import fitz  # PyMuPDF
from ..schema import IngestResult, PageContent, FileType

# If average extracted chars/page falls below this, we assume it's a scan.
# Real text-based PDFs almost always exceed this by a wide margin.
SCANNED_DOC_CHAR_THRESHOLD = 20


def parse_pdf(file_path: str, filename: str) -> IngestResult:
    doc = fitz.open(file_path)
    pages = []

    for page_num, page in enumerate(doc, start=1):
        text = page.get_text("text").strip()
        pages.append(PageContent(page_num=page_num, text=text))

    doc.close()

    total_chars = sum(p.char_count for p in pages)
    avg_chars_per_page = total_chars / len(pages) if pages else 0
    is_scanned = avg_chars_per_page < SCANNED_DOC_CHAR_THRESHOLD

    warning = None
    if is_scanned:
        warning = (
            f"Low text yield ({avg_chars_per_page:.1f} chars/page avg). "
            "Likely a scanned or image-only PDF — Phase 1 text extraction "
            "will produce poor/empty chunks. Flagged for Phase 2 (ColPali) handling."
        )

    return IngestResult(
        filename=filename,
        file_type=FileType.PDF,
        pages=pages,
        is_scanned_or_empty=is_scanned,
        warning=warning,
    )
