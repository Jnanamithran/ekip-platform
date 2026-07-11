"""
Chunking orchestrator.
Takes an IngestResult (from the ingestion module) and a document_id,
applies sliding-window chunking per page, and returns a flat list of
Chunk objects ready for embedding.

Skips pages flagged as scanned/empty at ingestion time — no point
chunking near-zero content, and it keeps garbage out of Qdrant.
"""

from typing import List, TYPE_CHECKING

from .schema import Chunk
from .sliding_window import sliding_window_chunks, DEFAULT_CHUNK_SIZE_WORDS, DEFAULT_OVERLAP_WORDS

if TYPE_CHECKING:
    from ingestion.schema import IngestResult


def chunk_document(
    ingest_result: "IngestResult",
    document_id: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE_WORDS,
    overlap: int = DEFAULT_OVERLAP_WORDS,
) -> List[Chunk]:
    if ingest_result.is_scanned_or_empty:
        # Nothing usable to chunk — caller should log/flag this document
        # for Phase 2 (ColPali) handling instead.
        return []

    all_chunks: List[Chunk] = []

    for page in ingest_result.pages:
        if not page.text.strip():
            continue

        window_texts = sliding_window_chunks(page.text, chunk_size, overlap)

        for idx, window_text in enumerate(window_texts):
            chunk = Chunk(
                document_id=document_id,
                filename=ingest_result.filename,
                file_type=ingest_result.file_type.value,
                page_num=page.page_num,
                chunk_index=idx,
                text=window_text,
            )
            all_chunks.append(chunk)

    return all_chunks
