"""
RBAC metadata contract.
This is the CRITICAL piece for the platform's core security rule:
"RBAC happens BEFORE retrieval — unauthorized documents must NEVER
reach the LLM, not even to be filtered later."

This metadata is attached to every vector at embedding/upsert time,
not applied as a post-hoc filter. Step 5 (RBAC filter) queries Qdrant
using this payload as a hard filter condition — vectors that don't
match are never returned by Qdrant's search in the first place, so
they never reach reranking or the LLM.
"""

from typing import List
from pydantic import BaseModel


class RBACMetadata(BaseModel):
    org_id: str
    workspace_id: str
    department_id: str
    allowed_roles: List[str]   # e.g. ["Admin", "Manager"] — roles permitted to retrieve this chunk
    uploaded_by: str           # user_id of uploader, for audit trail

    def as_payload(self) -> dict:
        return {
            "org_id": self.org_id,
            "workspace_id": self.workspace_id,
            "department_id": self.department_id,
            "allowed_roles": self.allowed_roles,
            "uploaded_by": self.uploaded_by,
        }
