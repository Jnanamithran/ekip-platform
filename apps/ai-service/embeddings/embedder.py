"""
Dense embedding generator using Sentence Transformers.
Model is loaded ONCE as a module-level singleton — loading it per-request
would be a severe performance hit (model load takes seconds; inference
takes milliseconds).

Model: all-MiniLM-L6-v2
  - 384-dim output vectors
  - Chosen for VRAM headroom: this service also runs a cross-encoder
    reranker (Step 7) and shares a GPU with Ollama (Step 8) — a heavier
    model (e.g. mpnet, 768-dim) would create memory pressure across the
    three concurrently-loaded models.
"""

from typing import List
from sentence_transformers import SentenceTransformer

MODEL_NAME = "all-MiniLM-L6-v2"
VECTOR_SIZE = 384

_model: SentenceTransformer | None = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME)
    return _model


def embed_texts(texts: List[str]) -> List[List[float]]:
    """
    Batch-embeds a list of texts. Always batch instead of calling
    per-chunk in a loop — sentence-transformers is significantly faster
    with batched inference than repeated single-item calls.
    """
    if not texts:
        return []

    model = get_model()
    vectors = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
    return vectors.tolist()
