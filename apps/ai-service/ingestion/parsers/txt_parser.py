"""
Plain text parser. Simplest case — read and wrap as single page.
Handles common encoding issues gracefully instead of crashing on
non-UTF8 files (Windows exports are often cp1252/latin-1).
"""

from ..schema import IngestResult, PageContent, FileType


def parse_txt(file_path: str, filename: str) -> IngestResult:
    text = None
    for encoding in ("utf-8", "cp1252", "latin-1"):
        try:
            with open(file_path, "r", encoding=encoding) as f:
                text = f.read().strip()
            break
        except UnicodeDecodeError:
            continue

    if text is None:
        raise ValueError(f"Could not decode {filename} with any supported encoding.")

    pages = [PageContent(page_num=1, text=text)] if text else []
    is_empty = len(pages) == 0

    return IngestResult(
        filename=filename,
        file_type=FileType.TXT,
        pages=pages,
        is_scanned_or_empty=is_empty,
        warning="File is empty." if is_empty else None,
    )
