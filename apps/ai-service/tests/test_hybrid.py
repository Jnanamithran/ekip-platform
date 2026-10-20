import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from retrieval.service import hybrid_retrieve
from retrieval.schema import RBACContext

rbac = RBACContext(
    org_id="org-1",
    workspace_id="ws-1",
    department_id="dept-1",
    role="Manager",
    allowed_roles=["Admin", "Manager"],
)

results = hybrid_retrieve("What is RBAC?", rbac, top_k=3)
for i, r in enumerate(results, 1):
    print(f"#{i} page {r.page_num} | score {r.score} | {r.text[:100]}")