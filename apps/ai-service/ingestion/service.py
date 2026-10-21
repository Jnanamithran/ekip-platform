"""
Ingestion orchestrator.
Single entry point: given a file path, detect its type and route it
to the correct parser. This is the only function the rest of the
pipeline (chunking, embeddings) should import from ingestion.
"""

from .detector import detect_file_type, UnsupportedFileTypeError
from .schema import IngestResult, FileType


def ingest_document(file_path: str, filename: str) -> IngestResult:
    """
    Main ingestion entry point.

    Raises:
        UnsupportedFileTypeError: unsupported extension or signature mismatch.
        ValueError / parser-specific exceptions: file is corrupted or unreadable.
    """
    file_type = detect_file_type(file_path)
    if file_type == FileType.PDF:
        from .parsers.pdf_parser import parse_pdf

        parser_fn = parse_pdf
    elif file_type == FileType.DOCX:
        from .parsers.docx_parser import parse_docx

        parser_fn = parse_docx
    elif file_type == FileType.XLSX:
        from .parsers.xlsx_parser import parse_xlsx

        parser_fn = parse_xlsx
    else:
        from .parsers.txt_parser import parse_txt

        parser_fn = parse_txt

    result = parser_fn(file_path, filename)

    return result
