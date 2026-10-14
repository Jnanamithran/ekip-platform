import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from retrieval.service import hybrid_retrieve
from retrieval.schema import RBACContext
from reranking.reranker import rerank
from generation.generator import generate_answer

rbac = RBACContext(
    org_id="demo-org-001",
    workspace_id="demo-workspace-001",
    department_id="demo-dept-001",
    role="Admin"
)

query = "What is RBAC and why does it happen before retrieval?"

print(f"Query: {query}\n")

hybrid_results = hybrid_retrieve(query, rbac, top_k=10)
reranked       = rerank(query, hybrid_results, top_n=5)
result         = generate_answer(query, reranked)

print(f"Model : {result.model}")
print(f"Chunks used : {len(result.context_chunks)}\n")
print("Answer:")
print("─" * 60)
print(result.answer)
print("─" * 60)