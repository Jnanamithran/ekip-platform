import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/apiClient";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import Badge from "../components/ui/Badge";

export default function DepartmentEdit() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [departments, setDepartments] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("list"); // "list" | "create" | "edit"

  // Create form state
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createWorkspaceId, setCreateWorkspaceId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Edit form state
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editWorkspaceName, setEditWorkspaceName] = useState("");
  const [editCounts, setEditCounts] = useState({ users: 0, documents: 0 });
  const [updating, setUpdating] = useState(false);
  const [editError, setEditError] = useState("");

  // Delete modal state
  const [deletingDept, setDeletingDept] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [deptRes, wsRes] = await Promise.all([
        apiFetch("/admin/departments"),
        apiFetch("/admin/workspaces").catch(() => ({ workspaces: [] })),
      ]);
      setDepartments(deptRes.departments || []);
      setWorkspaces(wsRes.workspaces || []);
      if (wsRes.workspaces?.length && !createWorkspaceId) {
        setCreateWorkspaceId(wsRes.workspaces[0].id);
      }
    } catch (err) {
      setError(err.message || "Failed to load departments");
    } finally {
      setLoading(false);
    }
  }, [createWorkspaceId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle URL search param ?department=<id>
  useEffect(() => {
    const departmentId = searchParams.get("department");
    if (departmentId && departments.length) {
      const target = departments.find((d) => d.id === departmentId);
      if (target) {
        setEditId(target.id);
        setEditName(target.name);
        setEditDescription(target.description || "");
        setEditWorkspaceName(target.workspace?.name || "");
        setEditCounts({
          users: target._count?.users ?? 0,
          documents: target._count?.documents ?? 0,
        });
        setActiveTab("edit");
      }
    }
  }, [searchParams, departments]);

  function startEdit(dept) {
    setEditId(dept.id);
    setEditName(dept.name);
    setEditDescription(dept.description || "");
    setEditWorkspaceName(dept.workspace?.name || "");
    setEditCounts({
      users: dept._count?.users ?? 0,
      documents: dept._count?.documents ?? 0,
    });
    setEditError("");
    setActiveTab("edit");
    setSearchParams({ department: dept.id }, { replace: true });
  }

  function cancelEdit() {
    setEditId("");
    setEditName("");
    setEditDescription("");
    setEditError("");
    setActiveTab("list");
    setSearchParams({}, { replace: true });
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!createName.trim()) {
      setCreateError("Department name is required");
      return;
    }

    setCreating(true);
    setCreateError("");
    setError("");
    setSuccess("");

    try {
      await apiFetch("/admin/departments", {
        method: "POST",
        body: JSON.stringify({
          name: createName.trim(),
          description: createDescription.trim() || undefined,
          workspace_id: createWorkspaceId || undefined,
        }),
      });

      setSuccess(`Department "${createName.trim()}" created successfully.`);
      setCreateName("");
      setCreateDescription("");
      setActiveTab("list");
      await loadData();
    } catch (err) {
      setCreateError(err.message || "Could not create department");
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdate(e) {
    e.preventDefault();
    if (!editName.trim()) {
      setEditError("Department name is required");
      return;
    }

    setUpdating(true);
    setEditError("");
    setError("");
    setSuccess("");

    try {
      await apiFetch(`/admin/departments/${encodeURIComponent(editId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
        }),
      });

      setSuccess(`Department updated successfully.`);
      cancelEdit();
      await loadData();
    } catch (err) {
      setEditError(err.message || "Could not update department");
    } finally {
      setUpdating(false);
    }
  }

  async function handleDelete() {
    if (!deletingDept) return;

    setDeleting(true);
    setDeleteError("");
    setError("");
    setSuccess("");

    try {
      await apiFetch(`/admin/departments/${encodeURIComponent(deletingDept.id)}`, {
        method: "DELETE",
      });

      setSuccess(`Department "${deletingDept.name}" deleted successfully.`);
      setDeletingDept(null);
      if (editId === deletingDept.id) {
        cancelEdit();
      }
      await loadData();
    } catch (err) {
      setDeleteError(err.message || "Could not delete department");
    } finally {
      setDeleting(false);
    }
  }

  const filteredDepartments = departments.filter((dept) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const nameMatch = dept.name?.toLowerCase().includes(q);
    const descMatch = dept.description?.toLowerCase().includes(q);
    const wsMatch = dept.workspace?.name?.toLowerCase().includes(q);
    return nameMatch || descMatch || wsMatch;
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl text-ink">Department management</h1>
          <p className="text-sm text-slate">
            Create, edit, and organize departments across your workspaces.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={activeTab === "list" ? "primary" : "secondary"}
            onClick={() => {
              if (activeTab === "edit") cancelEdit();
              else setActiveTab("list");
            }}
          >
            All departments ({departments.length})
          </Button>
          <Button
            type="button"
            variant={activeTab === "create" ? "primary" : "secondary"}
            onClick={() => {
              setCreateError("");
              setActiveTab("create");
            }}
          >
            + Add department
          </Button>
        </div>
      </div>

      {/* Global Alerts */}
      {success && (
        <div
          role="status"
          className="rounded-md border border-hairline bg-paper-raised px-4 py-3 text-sm text-success"
        >
          {success}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-hairline bg-paper-raised px-4 py-3 text-sm text-danger"
        >
          {error}
        </div>
      )}

      {/* CREATE TAB */}
      {activeTab === "create" && (
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="font-medium text-ink">Create new department</h2>
            <p className="text-xs text-slate">
              Departments group members and documents within a workspace.
            </p>
          </div>
          <form onSubmit={handleCreate} className="flex max-w-lg flex-col gap-4">
            {workspaces.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="create-workspace"
                  className="text-sm font-medium text-ink-soft"
                >
                  Workspace
                </label>
                <select
                  id="create-workspace"
                  value={createWorkspaceId}
                  onChange={(e) => setCreateWorkspaceId(e.target.value)}
                  className="rounded-md border border-hairline bg-paper-raised px-3 py-2 text-sm text-ink focus:border-index focus:outline-none"
                >
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <Input
              id="create-dept-name"
              label="Department name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. Engineering, Sales, Legal"
              maxLength={80}
              required
              autoFocus
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="create-dept-desc" className="text-sm font-medium text-ink-soft">
                Description (optional)
              </label>
              <textarea
                id="create-dept-desc"
                rows={2}
                maxLength={240}
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Brief summary of department responsibilities..."
                className="rounded-md border border-hairline bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-slate-light focus:border-index focus:outline-none resize-none"
              />
            </div>

            {createError && (
              <p role="alert" className="text-xs text-danger">
                {createError}
              </p>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={creating || !createName.trim()}>
                {creating ? "Creating…" : "Create department"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setCreateName("");
                  setCreateDescription("");
                  setCreateError("");
                  setActiveTab("list");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* EDIT TAB */}
      {activeTab === "edit" && (
        <Card className="p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
            <div>
              <h2 className="font-medium text-ink">Edit department</h2>
              <p className="text-xs text-slate">
                Workspace: <span className="text-ink font-medium">{editWorkspaceName || "Default"}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge>
                {editCounts.users} member{editCounts.users === 1 ? "" : "s"}
              </Badge>
              <Badge>
                {editCounts.documents} doc{editCounts.documents === 1 ? "" : "s"}
              </Badge>
            </div>
          </div>

          <form onSubmit={handleUpdate} className="flex max-w-lg flex-col gap-4">
            <Input
              id="edit-dept-name"
              label="Department name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="e.g. Engineering"
              maxLength={80}
              required
              autoFocus
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-dept-desc" className="text-sm font-medium text-ink-soft">
                Description (optional)
              </label>
              <textarea
                id="edit-dept-desc"
                rows={2}
                maxLength={240}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Brief summary of department responsibilities..."
                className="rounded-md border border-hairline bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-slate-light focus:border-index focus:outline-none resize-none"
              />
            </div>

            {editError && (
              <p role="alert" className="text-xs text-danger">
                {editError}
              </p>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={updating || !editName.trim()}>
                {updating ? "Saving…" : "Save changes"}
              </Button>
              <Button type="button" variant="secondary" onClick={cancelEdit}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* LIST TAB */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
          <h2 className="text-sm font-medium text-ink">All departments</h2>
          <div className="w-full sm:w-64">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search departments…"
              className="w-full rounded-md border border-hairline bg-paper-raised px-3 py-1.5 text-xs text-ink placeholder:text-slate-light focus:border-index focus:outline-none"
            />
          </div>
        </div>

        {loading ? (
          <p className="p-6 text-center text-sm text-slate">Loading departments…</p>
        ) : filteredDepartments.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-slate">
              {departments.length === 0
                ? "No departments found. Create your first department above."
                : "No departments match your search filter."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-hairline">
            {filteredDepartments.map((dept) => {
              const memberCount = dept._count?.users ?? 0;
              const docCount = dept._count?.documents ?? 0;
              const hasRecords = memberCount > 0 || docCount > 0;

              return (
                <div
                  key={dept.id}
                  className="flex flex-wrap items-center justify-between gap-4 p-4 transition-colors hover:bg-paper-raised/40"
                >
                  <div className="flex flex-col gap-1 min-w-48">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-ink">{dept.name}</span>
                      {dept.workspace?.name && (
                        <span className="rounded bg-paper-raised px-1.5 py-0.5 text-[10px] text-slate border border-hairline">
                          {dept.workspace.name}
                        </span>
                      )}
                    </div>
                    {dept.description && (
                      <p className="text-xs text-slate-light max-w-md">{dept.description}</p>
                    )}
                    <p className="text-xs text-slate">
                      {memberCount} member{memberCount === 1 ? "" : "s"} · {docCount} document{docCount === 1 ? "" : "s"}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-3 py-1 text-xs"
                      onClick={() => startEdit(dept)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className={`px-3 py-1 text-xs hover:text-danger ${hasRecords ? "opacity-60" : ""}`}
                      onClick={() => {
                        setDeleteError("");
                        setDeletingDept(dept);
                      }}
                      title={
                        hasRecords
                          ? "Department has members or documents attached"
                          : "Delete department"
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* DELETE CONFIRMATION MODAL */}
      {deletingDept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="flex w-full max-w-md flex-col gap-4 p-6 shadow-xl">
            <div>
              <h2 className="font-display text-lg text-ink">Delete department</h2>
              <p className="mt-1 text-sm text-slate">
                Department: <strong className="text-ink">{deletingDept.name}</strong>
              </p>
            </div>

            {(deletingDept._count?.users ?? 0) > 0 ||
            (deletingDept._count?.documents ?? 0) > 0 ? (
              <div className="rounded-md border border-hairline bg-paper-raised p-4 text-xs text-slate">
                <p className="font-medium text-danger">Cannot delete this department</p>
                <p className="mt-1 leading-relaxed">
                  This department currently has{" "}
                  <strong>{deletingDept._count?.users ?? 0} member(s)</strong> and{" "}
                  <strong>{deletingDept._count?.documents ?? 0} document(s)</strong>.
                </p>
                <p className="mt-2 text-slate-light">
                  To protect your organization’s data, you must reassign or remove all members and documents from this department before it can be deleted.
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate">
                Are you sure you want to delete this department? This action is permanent and cannot be undone.
              </p>
            )}

            {deleteError && (
              <p role="alert" className="text-xs text-danger">
                {deleteError}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                disabled={deleting}
                onClick={() => setDeletingDept(null)}
              >
                {(deletingDept._count?.users ?? 0) > 0 ||
                (deletingDept._count?.documents ?? 0) > 0
                  ? "Close"
                  : "Cancel"}
              </Button>
              {(deletingDept._count?.users ?? 0) === 0 &&
                (deletingDept._count?.documents ?? 0) === 0 && (
                  <Button
                    type="button"
                    variant="danger"
                    disabled={deleting}
                    onClick={handleDelete}
                  >
                    {deleting ? "Deleting…" : "Delete department"}
                  </Button>
                )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
