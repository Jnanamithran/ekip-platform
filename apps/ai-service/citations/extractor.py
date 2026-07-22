"""
Citation Extraction — Step 9.

Takes the LLM's generated answer (Step 8) and the context chunks that
were passed to it, then maps every [SOURCE N] reference in the answer
back to the exact document, filename, and page number it came from.

Pipeline position
─────────────────
generate_answer(query, reranked_chunks)   ← Step 8
        ↓
extract_citations(result)                 ← Step 9  (this module)
        ↓
Final API response: answer + citations    ← what the frontend receives

Why this matters
────────────────
A RAG answer without citations is just a chatbot response — unverifiable
and untrustworthy. Citations are what make EKIP enterprise-grade:
every claim in the answer can be traced back to an exact page in an
exact document. Users can verify. Auditors can trace. Hallucinations
become visible when no source exists for a claim.

How it works
────────────
The prompt template in Step 8 prefixes each context chunk with:
    [SOURCE N | filename | page P]

The LLM is instructed to reference sources inline as [SOURCE N].
This module parses those references out of the answer text and
maps each N back to the corresponding chunk in context_chunks.

Design decision — why not use NLP entity extraction?
Regex on a controlled prompt format is simpler, faster, and more
reliable than NLP-based extraction here. The prompt format is ours —
we control it. Regex is the right tool.
"""

import re
from typing import List, Dict
from dataclasses import dataclass

from generation.generator import GenerationResult


# ── Output schema ─────────────────────────────────────────────────────────────

@dataclass
class Citation:
    """
    A single source citation extracted from the LLM answer.

    source_num   — the [SOURCE N] number as it appears in the answer.
    filename     — the document file this chunk came from.
    page_num     — the page number within that document.
    chunk_text   — the full text of the source chunk (for UI preview).
    chunk_id     — the Qdrant point ID (for deep linking later).
    document_id  — the document UUID (for backend document lookup).
    """
    source_num:  int
    filename:    str
    page_num:    int
    chunk_text:  str
    chunk_id:    str
    document_id: str


@dataclass
class CitedAnswer:
    """
    The complete output of the citation pipeline.
    This is what the FastAPI endpoint will return to the frontend.

    answer      — the LLM's answer with [SOURCE N] markers intact.
    citations   — list of Citation objects, one per unique source referenced.
    model       — which Ollama model generated the answer.
    query       — the original user question (for logging/debugging).
    has_answer  — False if the model said it couldn't find an answer.
    """
    answer:     str
    citations:  List[Citation]
    model:      str
    query:      str
    has_answer: bool


# ── Regex pattern ─────────────────────────────────────────────────────────────

# Matches [SOURCE 1], [SOURCE 2], [SOURCE 1, SOURCE 2], [SOURCE 1, 2] etc.
# Handles all common formats the LLM might produce despite prompt instructions.
_SOURCE_PATTERN = re.compile(r'\[SOURCE\s+(\d+(?:[,\-]\s*(?:SOURCE\s+)?\d+)*)\]', re.IGNORECASE)

# Detect "no answer" responses — model said it couldn't find the answer
_NO_ANSWER_PHRASES = [
    "i could not find",
    "no information",
    "not mentioned",
    "not provided",
    "cannot find",
    "does not contain",
    "no clear answer",
]


def _parse_source_numbers(match_text: str) -> List[int]:
    """Extract all source numbers from a [SOURCE N] match string."""
    numbers = []
    # Handle ranges like "1-5" → [1, 2, 3, 4, 5]
    parts = re.split(r',', match_text)
    for part in parts:
        part = part.strip()
        range_match = re.match(r'(\d+)\s*[-–]\s*(\d+)', part)
        if range_match:
            start, end = int(range_match.group(1)), int(range_match.group(2))
            numbers.extend(range(start, end + 1))
        else:
            digits = re.findall(r'\d+', part)
            numbers.extend(int(d) for d in digits)
    return numbers


def _is_no_answer(answer: str) -> bool:
    """Check if the model indicated it couldn't find an answer."""
    lower = answer.lower()
    return any(phrase in lower for phrase in _NO_ANSWER_PHRASES)


# ── Public API ────────────────────────────────────────────────────────────────

def extract_citations(result: GenerationResult, query: str) -> CitedAnswer:
    """
    Parse [SOURCE N] references from the LLM answer and map them back
    to the context chunks that were passed to the model.

    Args:
        result:  GenerationResult from Step 8 — contains the answer,
                 the context chunks, and the model name.
        query:   The original user question (passed through for logging).

    Returns:
        CitedAnswer with the answer text and a list of Citation objects
        for every unique source the model referenced.
        If the model referenced a source number that doesn't exist in
        context_chunks (e.g. hallucinated [SOURCE 9] when only 3 chunks
        were passed), that reference is silently skipped — this is a
        safety measure, not an error.
    """
    answer = result.answer
    chunks = result.context_chunks

    # Build a 1-based lookup map: source number → chunk
    # The prompt numbers chunks starting at 1, matching chunk index + 1
    chunk_map: Dict[int, object] = {
        i + 1: chunk for i, chunk in enumerate(chunks)
    }

    # Find all [SOURCE N] references in the answer
    matches = _SOURCE_PATTERN.finditer(answer)

    seen_source_nums = set()
    citations: List[Citation] = []

    for match in matches:
        source_nums = _parse_source_numbers(match.group(1))
        for num in source_nums:
            if num in seen_source_nums:
                continue  # deduplicate — same source cited twice
            seen_source_nums.add(num)

            chunk = chunk_map.get(num)
            if chunk is None:
                # Model hallucinated a source number — skip silently
                continue

            citations.append(Citation(
                source_num  = num,
                filename    = chunk.filename,
                page_num    = chunk.page_num,
                chunk_text  = chunk.text,
                chunk_id    = chunk.chunk_id,
                document_id = chunk.document_id,
            ))

    # Sort citations by source number for consistent ordering
    citations.sort(key=lambda c: c.source_num)

    return CitedAnswer(
        answer     = answer,
        citations  = citations,
        model      = result.model,
        query      = query,
        has_answer = not _is_no_answer(answer),
    )