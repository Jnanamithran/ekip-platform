import { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import { RoleBadge } from "../components/ui/Badge";
import QueryActivityChart from "../components/dashboard/QueryActivityChart";

export default function WorkspaceSettings() {
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [loading, setLoading] = useState(true);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch("/admin/workspaces")
      .then(({ workspaces: result }) => {
        if (!active) return;
        setWorkspaces(result);
        setDashboardLoading(Boolean(result[0]));
        setWorkspaceId(result[0]?.id || "");
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      return undefined;
    }

    let active = true;
    apiFetch(`/admin/workspaces/${encodeURIComponent(workspaceId)}`)
      .then(({ workspace }) => {
        if (!active) return;
        setDashboard(workspace);
        setWorkspaceName(workspace.name);
      })
      .catch((loadError) => {
        if (active) setSaveError(loadError.message);
      })
      .finally(() => {
        if (active) setDashboardLoading(false);
      });

    return () => {
      active = false;
    };
  }, [workspaceId]);

  async function saveWorkspaceName(event) {
    event.preventDefault();
    if (!dashboard || !workspaceName.trim() || saving) return;

    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const { workspace } = await apiFetch(
        `/admin/workspaces/${encodeURIComponent(dashboard.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: workspaceName }),
        }
      );
      setWorkspaceName(workspace.name);
      setDashboard((current) => ({ ...current, name: workspace.name }));
      setWorkspaces((current) =>
        current.map((item) =>
          item.id === workspace.id ? { ...item, name: workspace.name } : item
        )
      );
      setSaved(true);
    } catch (saveError) {
      setSaveError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl text-ink">Workspace dashboard</h1>
          <p className="text-sm text-slate">
            Overview and settings for your organization’s workspaces.
          </p>
        </div>
        {!loading && workspaces.length > 1 && (
          <label className="flex flex-col gap-1 text-xs font-medium text-slate">
            Select workspace
            <select
              value={workspaceId}
              onChange={(event) => {
                setDashboardLoading(true);
                setSaveError("");
                setSaved(false);
                setWorkspaceId(event.target.value);
              }}
              className="min-w-52 rounded-md border border-hairline bg-paper-raised px-3 py-2 text-sm text-ink"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loading ? (
        <p role="status" className="text-sm text-slate">Loading workspace data…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-danger">Failed to load workspaces: {error}</p>
      ) : !workspaces.length ? (
        <Card className="p-5 text-sm text-slate">No workspaces found for this organization.</Card>
      ) : dashboardLoading ? (
        <p role="status" className="text-sm text-slate">Loading dashboard…</p>
      ) : dashboard ? (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-5 p-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-light">
                Organization
              </p>
              <p className="mt-1 text-sm font-medium text-ink">
                {dashboard.organization_name}
              </p>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-light">
                Workspace
              </p>
              <p className="mt-1 font-display text-xl text-ink">{dashboard.name}</p>
            </div>
            <form onSubmit={saveWorkspaceName} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-slate">
                Edit workspace name
                <input
                  required
                  maxLength={120}
                  value={workspaceName}
                  onChange={(event) => {
                    setWorkspaceName(event.target.value);
                    setSaved(false);
                  }}
                  className="w-64 rounded-md border border-hairline bg-paper-raised px-3 py-2 text-sm text-ink"
                />
              </label>
              <Button type="submit" disabled={saving || !workspaceName.trim()}>
                {saving ? "Saving…" : "Save name"}
              </Button>
            </form>
            {saveError && (
              <p role="alert" className="w-full text-sm text-danger">{saveError}</p>
            )}
            {saved && (
              <p role="status" className="w-full text-sm text-success">Workspace name updated.</p>
            )}
          </Card>

          <section className="grid gap-4 sm:grid-cols-3" aria-label="Workspace totals">
            {[
              { label: "Members", value: dashboard.stats.members },
              { label: "Departments", value: dashboard.stats.departments },
              { label: "Documents", value: dashboard.stats.documents },
            ].map((metric) => (
              <Card key={metric.label} className="p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-light">
                  {metric.label}
                </p>
                <p className="mt-2 font-display text-3xl text-ink">{metric.value}</p>
              </Card>
            ))}
          </section>

          <QueryActivityChart />

          <div className="grid gap-6">
            <Card className="overflow-hidden">
              <div className="border-b border-hairline px-4 py-3">
                <h2 className="text-sm font-medium text-ink">Departments and members</h2>
              </div>
              {dashboard.departments.length ? (
                <div className="divide-y divide-hairline">
                  {dashboard.departments.map((department) => (
                    <section key={department.id} className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-medium text-ink">{department.name}</h3>
                        <span className="text-xs text-slate">
                          {department.member_count} members · {department.document_count} documents
                        </span>
                      </div>
                      {department.members.length ? (
                        <ul className="mt-3 divide-y divide-hairline">
                          {department.members.map((member) => (
                            <li
                              key={member.id}
                              className="flex items-center justify-between gap-3 py-2"
                            >
                              <span className="truncate text-sm text-ink-soft">{member.email}</span>
                              <RoleBadge role={member.role} />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 text-xs text-slate">No members in this department.</p>
                      )}
                    </section>
                  ))}
                </div>
              ) : (
                <p className="p-4 text-sm text-slate">No departments in this workspace yet.</p>
              )}
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
