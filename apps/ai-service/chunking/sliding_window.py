"""
Sliding window chunker with overlap.
Word-based (not character-based) since word count approximates token count
far more reliably across languages/content types — important since embedding
models (Sentence Transformers) have hard token limits (~256-384 tokens).

Design choice: chunks never cross page/row boundaries. A page's text is
split independently; if it's already smaller than the chunk size (common
for XLSX rows, short DOCX blocks), it's kept as a single chunk untouched
rather than being padded or merged with a neighboring page.
"""

from typing import List

# ~200 words ≈ 260-300 tokens for English text (safe margin under 384 token
# limits common to Sentence Transformer models like all-MiniLM/mpnet).
DEFAULT_CHUNK_SIZE_WORDS = 200
DEFAULT_OVERLAP_WORDS = 40  # 20% overlap — keeps context continuity across chunk edges


def sliding_window_chunks(
    text: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE_WORDS,
    overlap: int = DEFAULT_OVERLAP_WORDS,
) -> List[str]:
    """
    Splits text into overlapping word-count windows.
    Returns [text] unchanged if it's already <= chunk_size (no fragmentation
    of already-small units).
    """
    if overlap >= chunk_size:
        raise ValueError("overlap must be smaller than chunk_size")

    words = text.split()

    if len(words) <= chunk_size:
        return [text] if text.strip() else []

    chunks = []
    step = chunk_size - overlap
    start = 0

    while start < len(words):
        window = words[start : start + chunk_size]
        chunks.append(" ".join(window))

        if start + chunk_size >= len(words):
            break
        start += step

    return chunks
