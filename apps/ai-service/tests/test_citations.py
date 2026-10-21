"""
EKIP v0.2 — Full Pipeline Demo
Runs the complete pipeline: hybrid retrieval → reranker → Ollama → citations
Usage: python test_citations.py "<your question>"
Example: python test_citations.py "What is Retrieval-Augmented Generation?"
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from retrieval.service import hybrid_retrieve
from retrieval.schema import RBACContext
from reranking.reranker import rerank
from generation.generator import generate_answer
from citations.extractor import extract_citations

# ── args ─────────────────────────────────────────────────────────────────────
if len(sys.argv) < 2:
    print("\nUsage: python test_citations.py \"<your question>\"")
    print("Example: python test_citations.py \"What is RAG?\"\n")
    sys.exit(1)

query = sys.argv[1]

# ── RBAC context (hardcoded for demo — comes from JWT in v0.3) ────────────────
rbac = RBACContext(
    org_id="org-1",
    workspace_id="ws-1",
    department_id="dept-1",
    role_id="role-manager",
    allowed_role_ids=["role-admin", "role-manager"],
)

# ── helpers ───────────────────────────────────────────────────────────────────
RESET  = "\033[0m"
BOLD   = "\033[1m"
CYAN   = "\033[96m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
WHITE  = "\033[97m"
GREY   = "\033[90m"
RED    = "\033[91m"

def banner(title, color="\033[94m"):
    width = 60
    print(f"\n{BOLD}{color}{'═' * width}{RESET}")
    print(f"{BOLD}{color}  {title}{RESET}")
    print(f"{BOLD}{color}{'═' * width}{RESET}\n")

def step(label):
    print(f"{BOLD}{CYAN}  →  {label}{RESET}")

# ── pipeline ──────────────────────────────────────────────────────────────────
banner("EKIP  —  v0.2 Full Pipeline Demo", RED)
print(f"  {BOLD}Query :{RESET} {query}")
print(f"  {BOLD}Role  :{RESET} Admin  |  Org: demo-org-001\n")

step("Running hybrid retrieval (dense + BM25 + RRF)...")
hybrid_results = hybrid_retrieve(query, rbac, top_k=10)
print(f"  {GREEN}✔{RESET}  {len(hybrid_results)} chunks retrieved and fused\n")

step("Reranking with cross-encoder...")
reranked = rerank(query, hybrid_results, top_n=5)
print(f"  {GREEN}✔{RESET}  Top {len(reranked)} chunks reranked\n")

step("Generating answer with Ollama (llama3.2:3b)...")
generation = generate_answer(query, reranked)
print(f"  {GREEN}✔{RESET}  Answer generated\n")

step("Extracting citations...")
cited = extract_citations(generation, query)
print(f"  {GREEN}✔{RESET}  {len(cited.citations)} citation(s) found\n")

# ── output ────────────────────────────────────────────────────────────────────
banner("Answer", "\033[92m")
print(f"{WHITE}{cited.answer}{RESET}")
print()

banner("Citations", "\033[93m")
if not cited.citations:
    print(f"  {GREY}No citations found — model may have answered without referencing sources.{RESET}\n")
else:
    for c in cited.citations:
        print(f"  {BOLD}{YELLOW}[SOURCE {c.source_num}]{RESET}")
        print(f"  {GREY}  File    :{RESET} {c.filename}")
        print(f"  {GREY}  Page    :{RESET} {c.page_num}")
        print(f"  {GREY}  Preview :{RESET} {WHITE}{c.chunk_text[:150]}...{RESET}")
        print()

print(f"  {GREY}Model : {cited.model}  |  Has answer : {cited.has_answer}{RESET}\n")
