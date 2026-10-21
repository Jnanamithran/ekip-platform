from retrieval import service
from retrieval.schema import RBACContext


def test_dense_search_always_filters_by_workspace(monkeypatch):
    captured = {}

    class SearchClient:
        def search(self, **kwargs):
            captured.update(kwargs)
            return []

    monkeypatch.setattr(service, 'embed_texts', lambda texts: [[0.1, 0.2]])
    monkeypatch.setattr(service, 'get_client', lambda: SearchClient())

    service._dense_search(
        'query',
        RBACContext(
            org_id='org-1',
            workspace_id='workspace-2',
            department_id='department-1',
            department_ids=['department-1'],
            role_id='role-1',
            allowed_role_ids=['role-1'],
        ),
        top_k=5,
    )

    filter_fields = {
        condition.key: condition.match
        for condition in captured['query_filter'].must
    }
    assert filter_fields['org_id'].value == 'org-1'
    assert filter_fields['workspace_id'].value == 'workspace-2'
