import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from retrieval.service import hybrid_retrieve
from retrieval.schema import RBACContext
from reranking.reranker import rerank

rbac = RBACContext(
    org_id="demo-org-001",
    workspace_id="demo-workspace-001",
    department_id="demo-dept-001",
    role="Admin"
)

query = "What is RBAC?"

# Step 6 — get hybrid results
hybrid_results = hybrid_retrieve(query, rbac, top_k=10)
print(f"Hybrid returned {len(hybrid_results)} chunks\n")

# Step 7 — rerank
reranked = rerank(query, hybrid_results, top_n=3)
print("Reranked top 3:\n")
for i, r in enumerate(reranked, 1):
    print(f"#{i} page {r.page_num} | score {r.score:.4f} | {r.text[:120]}")
    print()