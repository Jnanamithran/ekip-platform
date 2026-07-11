"""
Detects file type from extension AND file signature (magic bytes),
so a mislabeled or renamed file doesn't silently route to the wrong parser.
"""

from pathlib import Path
from .schema import FileType


# Magic byte signatures for the formats we support
_SIGNATURES = {
    b"%PDF": FileType.PDF,
    b"PK\x03\x04": None,  # zip-based (docx/xlsx) — needs deeper check
}

SUPPORTED_EXTENSIONS = {
    ".pdf": FileType.PDF,
    ".docx": FileType.DOCX,
    ".xlsx": FileType.XLSX,
    ".txt": FileType.TXT,
}


class UnsupportedFileTypeError(Exception):
    pass


def detect_file_type(file_path: str) -> FileType:
    """
    Two-stage detection:
    1. Extension check (fast, primary signal)
    2. Magic byte verification (catches renamed/corrupted files)
    """
    path = Path(file_path)
    ext = path.suffix.lower()

    if ext not in SUPPORTED_EXTENSIONS:
        raise UnsupportedFileTypeError(
            f"'{ext}' is not supported. Allowed: {list(SUPPORTED_EXTENSIONS.keys())}"
        )

    expected_type = SUPPORTED_EXTENSIONS[ext]

    with open(file_path, "rb") as f:
        header = f.read(8)

    # PDF: verify magic bytes strictly
    if expected_type == FileType.PDF and not header.startswith(b"%PDF"):
        raise UnsupportedFileTypeError(
            f"File has .pdf extension but invalid PDF signature: {file_path}"
        )

    # DOCX/XLSX: both are zip containers (Office Open XML), verify zip signature
    if expected_type in (FileType.DOCX, FileType.XLSX) and not header.startswith(b"PK\x03\x04"):
        raise UnsupportedFileTypeError(
            f"File has {ext} extension but invalid archive signature: {file_path}"
        )

    return expected_type
