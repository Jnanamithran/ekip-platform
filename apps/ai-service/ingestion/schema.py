"""
Structured output contract for the ingestion layer.
Every parser (pdf, docx, xlsx, txt) must return an IngestResult,
regardless of internal implementation differences.
"""

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel


class FileType(str, Enum):
    PDF = "pdf"
    DOCX = "docx"
    XLSX = "xlsx"
    TXT = "txt"


class PageContent(BaseModel):
    """
    One 'unit' of extracted content.
    - PDF  -> one entry per page
    - DOCX -> one entry per N paragraphs (or whole doc, kept simple for now)
    - XLSX -> one entry per row (row_num used instead of page_num)
    - TXT  -> single entry, page_num = 1
    """
    page_num: int
    text: str
    char_count: int = 0

    def model_post_init(self, __context) -> None:
        self.char_count = len(self.text)


class IngestResult(BaseModel):
    filename: str
    file_type: FileType
    pages: List[PageContent]
    total_pages: int = 0
    is_scanned_or_empty: bool = False   # flag for near-zero extractable text
    warning: Optional[str] = None

    def model_post_init(self, __context) -> None:
        self.total_pages = len(self.pages)
