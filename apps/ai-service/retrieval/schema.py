"""
Contracts for the retrieval layer.

RBACContext is the QUERY-TIME counterpart to embeddings.RBACMetadata
(which is the WRITE-TIME version attached to each vector). At query time
we know the requesting user's single role; at write time each chunk
carries a list of roles allowed to see it. Filtering checks whether the
querier's role appears in that list.
"""

from typing import List, Optional
from pydantic import BaseModel


class RBACContext(BaseModel):
    """Identifies who is asking, for filtering purposes.

    `allowed_roles` is the requesting user's effective role set (typically a
    single role). Retrieval keeps chunks whose stored `allowed_roles` overlap
    this set, so RBAC happens before any vector reaches the LLM.
    """
    org_id: str
    workspace_id: str
    department_id: str
    role: str            # e.g. "Manager" — the requesting user's own role
    allowed_roles: List[str]   # roles permitted to retrieve this chunk


class RetrievedChunk(BaseModel):
    chunk_id: str
    document_id: str
    filename: str
    page_num: int
    text: str
    score: float                 # BM25 relevance score for this query
    source: str = "sparse"       # will matter once Step 6 fuses with "dense"
