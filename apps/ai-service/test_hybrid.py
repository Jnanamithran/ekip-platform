import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from retrieval.service import hybrid_retrieve
from retrieval.schema import RBACContext

rbac = RBACContext(
    org_id="demo-org-001",
    workspace_id="demo-workspace-001",
    department_id="demo-dept-001",
    role="Admin"
)

results = hybrid_retrieve("What is RBAC?", rbac, top_k=3)
for i, r in enumerate(results, 1):
    print(f"#{i} page {r.page_num} | score {r.score} | {r.text[:100]}")