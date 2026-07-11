"""
XLSX parser using openpyxl.
Each row becomes one PageContent unit (row-per-chunk), prefixed with the
sheet name and header row so retrieval keeps row-level context intact.
Good for factual/lookup-style queries (e.g. "what's the price of item X").
"""

import openpyxl
from ..schema import IngestResult, PageContent, FileType


def parse_xlsx(file_path: str, filename: str) -> IngestResult:
    wb = openpyxl.load_workbook(file_path, data_only=True)
    pages = []
    row_counter = 0

    for sheet in wb.worksheets:
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            continue

        header = [str(c) if c is not None else "" for c in rows[0]]

        for row in rows[1:]:
            row_counter += 1
            values = [str(c) if c is not None else "" for c in row]

            # Skip fully empty rows
            if not any(v.strip() for v in values):
                continue

            # e.g. "Sheet: Inventory | Name: Widget A | Price: 250 | Stock: 12"
            paired = [f"{h}: {v}" for h, v in zip(header, values) if v.strip()]
            row_text = f"Sheet: {sheet.title} | " + " | ".join(paired)

            pages.append(PageContent(page_num=row_counter, text=row_text))

    is_empty = len(pages) == 0

    return IngestResult(
        filename=filename,
        file_type=FileType.XLSX,
        pages=pages,
        is_scanned_or_empty=is_empty,
        warning="No data rows found in any sheet." if is_empty else None,
    )
