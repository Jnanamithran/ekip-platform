"""
Ingestion orchestrator.
Single entry point: given a file path, detect its type and route it
to the correct parser. This is the only function the rest of the
pipeline (chunking, embeddings) should import from ingestion.
"""

from .detector import detect_file_type, UnsupportedFileTypeError
from .schema import IngestResult, FileType
from .parsers.pdf_parser import parse_pdf
from .parsers.docx_parser import parse_docx
from .parsers.xlsx_parser import parse_xlsx
from .parsers.txt_parser import parse_txt

_PARSER_MAP = {
    FileType.PDF: parse_pdf,
    FileType.DOCX: parse_docx,
    FileType.XLSX: parse_xlsx,
    FileType.TXT: parse_txt,
}


def ingest_document(file_path: str, filename: str) -> IngestResult:
    """
    Main ingestion entry point.

    Raises:
        UnsupportedFileTypeError: unsupported extension or signature mismatch.
        ValueError / parser-specific exceptions: file is corrupted or unreadable.
    """
    file_type = detect_file_type(file_path)
    parser_fn = _PARSER_MAP[file_type]

    result = parser_fn(file_path, filename)

    return result
