import { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import Card from "../components/ui/Card";

export default function WorkspaceSettings() {
  const [workspaces, setWorkspaces] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    Promise.all([apiFetch("/admin/workspaces"), apiFetch("/admin/departments")])
      .then(([workspaceResult, departmentResult]) => {
        if (!active) return;
        setWorkspaces(workspaceResult.workspaces);
        setDepartments(departmentResult.departments);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-xl text-ink">Workspace settings</h1>
        <p className="text-sm text-slate">
          Admin-only. Configure workspace-level defaults.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate">Loading workspace data…</p>
      ) : error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="divide-y divide-hairline">
            <h2 className="px-4 py-3 text-sm font-medium text-ink">Workspaces</h2>
            {workspaces.length ? (
              workspaces.map((workspace) => (
                <p key={workspace.id} className="px-4 py-3 text-sm text-slate">
                  {workspace.name}
                </p>
              ))
            ) : (
              <p className="px-4 py-3 text-sm text-slate">No workspaces found.</p>
            )}
          </Card>
          <Card className="divide-y divide-hairline">
            <h2 className="px-4 py-3 text-sm font-medium text-ink">Departments</h2>
            {departments.length ? (
              departments.map((department) => (
                <p key={department.id} className="px-4 py-3 text-sm text-slate">
                  {department.name}
                </p>
              ))
            ) : (
              <p className="px-4 py-3 text-sm text-slate">No departments found.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
