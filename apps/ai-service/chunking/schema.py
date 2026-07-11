"""
Structured output contract for the chunking layer.
Every chunk carries enough metadata to be independently traced back to
its source document and page — required for Step 9 (citation post-processing)
and Step 5 (RBAC filtering, which attaches org/workspace/dept/role fields
on top of this at embedding time).
"""

import uuid
from typing import Optional
from pydantic import BaseModel, Field


class Chunk(BaseModel):
    chunk_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    document_id: str          # links back to the parent document
    filename: str
    file_type: str
    page_num: int              # source page/row — never crosses boundaries
    chunk_index: int           # order of this chunk within its page
    text: str
    word_count: int = 0
    char_count: int = 0

    def model_post_init(self, __context) -> None:
        self.word_count = len(self.text.split())
        self.char_count = len(self.text)
