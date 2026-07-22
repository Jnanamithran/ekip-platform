"""
LLM Generation — Step 8.

Takes the reranked chunks (Step 7 output) and generates a natural
language answer using a locally hosted Ollama model.

Pipeline position
─────────────────
rerank(query, hybrid_results, top_n=5)   ← Step 7
        ↓
generate_answer(query, chunks)           ← Step 8  (this module)
        ↓
citation post-processor                  ← Step 9

Design decisions
────────────────
1. Prompt template is structured so the LLM is forced to answer ONLY
   from the provided context — not from its training data. This is the
   core RAG contract: retrieval grounds the generation.

2. Each context chunk is prefixed with [SOURCE N | filename | page P]
   so the LLM can reference sources in its answer. Step 9 parses these
   references to build citations.

3. Temperature is set to 0.1 — near-deterministic output. Enterprise
   Q&A must be consistent and factual, not creative.

4. If the context does not contain enough information to answer the
   question, the model is instructed to say so explicitly rather than
   hallucinate. This is the explainability guarantee.

5. Model is configurable — defaults to llama3.2:3b but can be swapped
   to any Ollama-hosted model without changing calling code.
"""

from typing import List
from dataclasses import dataclass
import ollama

from retrieval.schema import RetrievedChunk


# ── Configuration ─────────────────────────────────────────────────────────────

DEFAULT_MODEL       = "llama3.2:3b"
OLLAMA_HOST         = "http://localhost:11434"
TEMPERATURE         = 0.1     # near-deterministic — factual Q&A, not creative
MAX_CONTEXT_CHUNKS  = 5       # how many chunks to include in the prompt
MAX_TOKENS          = 512     # answer length ceiling


# ── Output schema ─────────────────────────────────────────────────────────────

@dataclass
class GenerationResult:
    """
    The output of one LLM generation call.

    answer          — the model's natural language response.
    model           — which Ollama model produced it.
    context_chunks  — the chunks that were passed as context (Step 9 needs these).
    prompt          — the full prompt sent to the model (useful for debugging).
    """
    answer:         str
    model:          str
    context_chunks: List[RetrievedChunk]
    prompt:         str


# ── Prompt template ───────────────────────────────────────────────────────────

def _build_prompt(query: str, chunks: List[RetrievedChunk]) -> str:
    """
    Build the RAG prompt from the query and retrieved context chunks.

    Format:
        SYSTEM instruction (role + rules)
        CONTEXT block (numbered source passages)
        QUESTION
        ANSWER instruction
    """
    # Build numbered context block
    context_lines = []
    for i, chunk in enumerate(chunks, start=1):
        header = f"[SOURCE {i} | {chunk.filename} | page {chunk.page_num}]"
        context_lines.append(f"{header}\n{chunk.text.strip()}")

    context_block = "\n\n".join(context_lines)

    prompt = f"""You are an enterprise knowledge assistant. Your job is to answer the user's question accurately and concisely using ONLY the information provided in the context below.

Rules you must follow:
- Answer using ONLY the context provided. Do not use outside knowledge.
- If the context does not contain enough information to answer, say: "I could not find a clear answer in the available documents."
- Keep your answer concise and factual — 3 to 6 sentences maximum.
- When you use information from a source, reference it as [SOURCE N] inline in your answer.
- Do not make up facts, figures, or details not present in the context.

CONTEXT:
{context_block}

QUESTION:
{query}

ANSWER:"""

    return prompt


# ── Public API ────────────────────────────────────────────────────────────────

def generate_answer(
    query: str,
    chunks: List[RetrievedChunk],
    model: str = DEFAULT_MODEL,
) -> GenerationResult:
    """
    Generate a grounded natural language answer from reranked chunks.

    Args:
        query:   The original user question.
        chunks:  Reranked chunks from Step 7. Order matters — chunk #1
                 is the most relevant and appears first in the prompt.
        model:   Ollama model name. Defaults to llama3.2:3b.
                 Must be already pulled via `ollama pull <model>`.

    Returns:
        GenerationResult with the answer, model used, chunks used,
        and the full prompt (for debugging and Step 9 citation parsing).

    Raises:
        ollama.ResponseError: if the model is not available in Ollama.
        ConnectionError: if Ollama server is not running on port 11434.
    """
    if not chunks:
        return GenerationResult(
            answer         = "No relevant documents were found for your query.",
            model          = model,
            context_chunks = [],
            prompt         = "",
        )

    # Limit to top N chunks to avoid exceeding context window
    context_chunks = chunks[:MAX_CONTEXT_CHUNKS]

    prompt = _build_prompt(query, context_chunks)

    # Call Ollama — runs fully locally, no internet required after model pull
    response = ollama.chat(
        model   = model,
        messages = [{"role": "user", "content": prompt}],
        options  = {
            "temperature": TEMPERATURE,
            "num_predict": MAX_TOKENS,
        },
    )

    answer = response["message"]["content"].strip()

    return GenerationResult(
        answer         = answer,
        model          = model,
        context_chunks = context_chunks,
        prompt         = prompt,
    )