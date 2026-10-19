"""
EKIP v0.1 — Live Demo Script
Runs the full pipeline: ingest → chunk → embed → retrieve (dense + sparse)
Usage: python demo.py <path-to-document> "<your question>"
Example: python demo.py test.pdf "What is the leave policy?"
"""

import sys
import os
import uuid
import textwrap

# ── make sure all sibling packages resolve ──────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


# ── helpers ─────────────────────────────────────────────────────────────────

def banner(title: str, color: str = "\033[94m"):
    RESET = "\033[0m"
    BOLD  = "\033[1m"
    width = 60
    print(f"\n{BOLD}{color}{'═' * width}{RESET}")
    print(f"{BOLD}{color}  {title}{RESET}")
    print(f"{BOLD}{color}{'═' * width}{RESET}\n")


def step(num: int, label: str):
    CYAN  = "\033[96m"
    BOLD  = "\033[1m"
    RESET = "\033[0m"
    print(f"{BOLD}{CYAN}[STEP {num}] {label}{RESET}")


def ok(msg: str):
    print(f"  \033[92m✔\033[0m  {msg}")


def info(msg: str):
    print(f"  \033[93m→\033[0m  {msg}")


def print_chunk_result(rank: int, chunk, source_label: str):
    RESET  = "\033[0m"
    BOLD   = "\033[1m"
    YELLOW = "\033[93m"
    WHITE  = "\033[97m"
    GREY   = "\033[90m"
    GREEN  = "\033[92m"

    # Score label differs by method
    if source_label == "BM25":
        score_note = "keyword relevance"
    else:
        score_note = "semantic similarity (0–1)"

    print(f"  {BOLD}{YELLOW}#{rank}  {chunk.filename}  |  page {chunk.page_num}{RESET}")
    print(f"  {GREY}    Score : {chunk.score:.4f}  ({score_note}){RESET}")
    print(f"  {GREY}    Chunk ID : {chunk.chunk_id}{RESET}")
    print()

    # Full text — no truncation, wrapped cleanly
    full_text = textwrap.fill(chunk.text.replace("\n", " "), width=60)
    for line in full_text.splitlines():
        print(f"      {WHITE}{line}{RESET}")
    print()


# ── main ────────────────────────────────────────────────────────────────────

def main():
    # ── args ────────────────────────────────────────────────────────────────
    if len(sys.argv) < 3:
        print("\nUsage: python demo.py <file> \"<question>\"")
        print("Example: python demo.py test.pdf \"What is the refund policy?\"\n")
        sys.exit(1)

    file_path = sys.argv[1]
    question  = sys.argv[2]

    if not os.path.exists(file_path):
        print(f"\n  ✖  File not found: {file_path}\n")
        sys.exit(1)

    filename = os.path.basename(file_path)

    # ── demo RBAC context (hardcoded for presentation) ───────────────────────
    # In production this comes from the Node backend's JWT session.
    # For the demo, one fake org/workspace/dept/role is enough.
    DEMO_ORG        = "demo-org-001"
    DEMO_WORKSPACE  = "demo-workspace-001"
    DEMO_DEPT       = "demo-dept-001"
    DEMO_ROLE       = "Admin"
    DEMO_UPLOADER   = "jnani"

    # ── imports (after sys.path set) ─────────────────────────────────────────
    from ingestion.service        import ingest_document
    from chunking.service         import chunk_document
    from embeddings.service       import embed_and_upsert
    from embeddings.rbac_schema   import RBACMetadata
    from retrieval.service        import sparse_retrieve
    from retrieval.schema         import RBACContext

    # Dense search lives in embeddings/qdrant_client + embedder
    from embeddings.embedder      import embed_texts
    from embeddings.qdrant_client import get_client, COLLECTION_NAME
    from qdrant_client.models     import Filter, FieldCondition, MatchValue, SearchRequest

    # ── HEADER ───────────────────────────────────────────────────────────────
    banner("EKIP  —  Enterprise Knowledge Intelligence Platform", "\033[91m")
    print(f"  Document : {filename}")
    print(f"  Question : {question}")
    print(f"  Org      : {DEMO_ORG}")
    print(f"  Role     : {DEMO_ROLE}")
    print()

    # ════════════════════════════════════════════════════════════════════════
    # STEP 1 — INGESTION
    # ════════════════════════════════════════════════════════════════════════
    step(1, "Ingesting document")
    result = ingest_document(file_path, filename)

    if result.is_scanned_or_empty:
        print("\n  ✖  Document appears to be scanned / image-only.")
        print("     Phase 2 (ColPali + Qwen2-VL) will handle this.\n")
        sys.exit(0)

    ok(f"File type detected  : {result.file_type.value.upper()}")
    ok(f"Pages extracted     : {len(result.pages)}")
    total_words = sum(len(p.text.split()) for p in result.pages)
    ok(f"Total words         : {total_words:,}")
    print()

    # ════════════════════════════════════════════════════════════════════════
    # STEP 2 — CHUNKING
    # ════════════════════════════════════════════════════════════════════════
    step(2, "Chunking  (200-word sliding window, 40-word overlap)")

    document_id = str(uuid.uuid4())
    chunks = chunk_document(result, document_id=document_id)

    ok(f"Chunks created      : {len(chunks)}")
    ok(f"Chunk size          : ~200 words  |  overlap: 40 words (20%)")
    ok(f"Page boundaries     : respected  (each chunk traces to one page)")
    print()

    # ════════════════════════════════════════════════════════════════════════
    # STEP 3 — EMBED + STORE IN QDRANT (with RBAC metadata)
    # ════════════════════════════════════════════════════════════════════════
    step(3, "Embedding chunks → storing in Qdrant with RBAC metadata")

    rbac_meta = RBACMetadata(
        org_id        = DEMO_ORG,
        workspace_id  = DEMO_WORKSPACE,
        department_id = DEMO_DEPT,
        allowed_roles = [DEMO_ROLE, "Manager", "Employee"],
        uploaded_by   = DEMO_UPLOADER,
    )

    written = embed_and_upsert(chunks, rbac_meta)

    ok(f"Vectors written     : {written}")
    ok(f"Model               : all-MiniLM-L6-v2  (384 dimensions)")
    ok(f"Vector DB           : Qdrant  (collection: ekip_documents)")
    ok(f"RBAC attached       : org / workspace / dept / allowed_roles baked in at write time")
    print()

    # ════════════════════════════════════════════════════════════════════════
    # STEP 4 — RBAC FILTER  (runs before ANY search)
    # ════════════════════════════════════════════════════════════════════════
    step(4, "RBAC filter  — fetching only authorized chunks (no search yet)")

    rbac_ctx = RBACContext(
        org_id        = DEMO_ORG,
        workspace_id  = DEMO_WORKSPACE,
        department_id = DEMO_DEPT,
        role          = DEMO_ROLE,
    )

    # We call rbac_filter directly to show the count before search
    from retrieval.rbac_filter import fetch_authorized_chunks
    authorized = fetch_authorized_chunks(rbac_ctx)

    ok(f"Authorized chunks   : {len(authorized)}  (out of {written} total)")
    ok(f"Filter fields       : org_id  |  workspace_id  |  department_id  |  role")
    ok(f"Unauthorized chunks : never leave Qdrant — not filtered post-retrieval")
    print()

    # ════════════════════════════════════════════════════════════════════════
    # STEP 5A — SPARSE RETRIEVAL  (BM25 keyword search)
    # ════════════════════════════════════════════════════════════════════════
    step(5, "Sparse retrieval  — BM25 keyword search")
    info(f"Query: \"{question}\"")
    print()

    sparse_results = sparse_retrieve(question, rbac_ctx, top_k=3)

    if not sparse_results:
        print("  No BM25 results found for this query.\n")
    else:
        for i, chunk in enumerate(sparse_results, 1):
            print_chunk_result(i, chunk, "BM25")

    # ════════════════════════════════════════════════════════════════════════
    # STEP 5B — DENSE RETRIEVAL  (semantic / vector search)
    # ════════════════════════════════════════════════════════════════════════
    step(6, "Dense retrieval  — semantic vector search")
    info(f"Query: \"{question}\"")
    print()

    query_vector = embed_texts([question])[0]

    dense_filter = Filter(
        must=[
            FieldCondition(key="org_id",        match=MatchValue(value=DEMO_ORG)),
            FieldCondition(key="workspace_id",  match=MatchValue(value=DEMO_WORKSPACE)),
            FieldCondition(key="department_id", match=MatchValue(value=DEMO_DEPT)),
            FieldCondition(key="allowed_roles", match=MatchValue(value=DEMO_ROLE)),
        ]
    )

    client = get_client()
    dense_hits = client.search(
        collection_name = COLLECTION_NAME,
        query_vector    = query_vector,
        query_filter    = dense_filter,
        limit           = 3,
        with_payload    = True,
    )

    if not dense_hits:
        print("  No dense results found for this query.\n")
    else:
        from retrieval.schema import RetrievedChunk
        for i, hit in enumerate(dense_hits, 1):
            p = hit.payload or {}
            chunk = RetrievedChunk(
                chunk_id    = str(hit.id),
                document_id = p.get("document_id", ""),
                filename    = p.get("filename", ""),
                page_num    = p.get("page_num", 0),
                text        = p.get("text", ""),
                score       = hit.score,
                source      = "dense",
            )
            print_chunk_result(i, chunk, "Dense")

    # ════════════════════════════════════════════════════════════════════════
    # SCORE INTERPRETATION + WHY RESULTS DIFFER
    # ════════════════════════════════════════════════════════════════════════
    BOLD  = "\033[1m"
    CYAN  = "\033[96m"
    RESET = "\033[0m"
    GREY  = "\033[90m"

    print(f"\n{BOLD}{CYAN}── Why the two result sets may differ ──────────────────{RESET}")
    print(f"  {GREY}BM25   ranks by KEYWORD overlap — exact word matches.{RESET}")
    print(f"  {GREY}Dense  ranks by MEANING — finds similar concepts even{RESET}")
    print(f"  {GREY}       if the words are different (e.g. 'income' vs 'revenue').{RESET}")
    print(f"  {GREY}When they disagree, BOTH are partly right.{RESET}")
    print(f"  {GREY}v0.2 uses RRF to fuse both ranked lists into one{RESET}")
    print(f"  {GREY}superior result — then a reranker picks the best 3.{RESET}\n")

    # ════════════════════════════════════════════════════════════════════════
    # SUMMARY
    # ════════════════════════════════════════════════════════════════════════
    banner("v0.1 Complete — Pipeline Summary", "\033[92m")
    print(f"  ✔  Ingestion      : {len(result.pages)} pages extracted from {filename}")
    print(f"  ✔  Chunking       : {len(chunks)} chunks (200w / 40w overlap)")
    print(f"  ✔  Embeddings     : {written} vectors → Qdrant")
    print(f"  ✔  RBAC filter    : {len(authorized)} authorized chunks identified")
    print(f"  ✔  BM25 search    : top {len(sparse_results)} keyword results")
    print(f"  ✔  Dense search   : top {len(dense_hits)} semantic results")
    print()
    print("  Next  →  v0.2 adds RRF hybrid fusion + reranking + Ollama LLM + citations")
    print()


if __name__ == "__main__":
    main()