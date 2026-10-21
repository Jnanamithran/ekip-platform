"""
Contracts for the retrieval layer. RBACContext is the query-time counterpart
to embeddings.RBACMetadata, which is attached to every vector at write time.
"""

from typing import List
from pydantic import BaseModel


class RBACContext(BaseModel):
    """Identifies who is asking, for filtering purposes.

    Owners are scoped to their organization. Other users are scoped to their
    workspace, department, and assigned organization role.
    """
    org_id: str
    workspace_id: str
    department_id: str
    role_id: str
    is_owner: bool = False
    allowed_role_ids: List[str]


class RetrievedChunk(BaseModel):
    chunk_id: str
    document_id: str
    filename: str
    page_num: int
    text: str
    score: float                 # BM25 relevance score for this query
    source: str = "sparse"       # will matter once Step 6 fuses with "dense"
