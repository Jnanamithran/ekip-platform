import { useAuth } from "../lib/AuthContext";
import { useCallback, useEffect, useState } from "react";
import {
  createOrganizationRole,
  deleteOrganizationRole,
  getOrganizationRoles,
  getDepartments,
  updateOrganizationRole,
} from "../lib/apiClient";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";

const emptyDraft = {
  id: null,
  name: "",
  permissions: [],
  scope: "organization",
  department_id: "",
};

const PERMISSION_DETAILS = {
  "documents:search": {
    label: "Search documents",
    group: "Documents",
    description: "Search and query indexed documents across allowed departments",
  },
  "documents:upload": {
    label: "Upload documents",
    group: "Documents",
    description: "Upload new files to be processed and indexed",
  },
  "documents:delete": {
    label: "Delete documents",
    group: "Documents",
    description: "Permanently delete documents and remove their embeddings",
  },
  "documents:reindex": {
    label: "Reindex documents",
    group: "Documents",
    description: "Re-run text/visual pipeline on existing documents",
  },
  "documents:manage_access": {
    label: "Manage document access",
    group: "Documents",
    description: "Control role-based document access rules",
  },
  "drive:connect": {
    label: "Connect Google Drive",
    group: "Integrations",
    description: "Authenticate and connect Google Drive accounts",
  },
  "drive:import": {
    label: "Import from Drive",
    group: "Integrations",
    description: "Import files and folders directly from Google Drive",
  },
  "users:manage": {
    label: "Manage users",
    group: "Administration",
    description: "Create, edit, deactivate users, and reset user passwords",
  },
  "roles:manage": {
    label: "Manage roles",
    group: "Administration",
    description: "Create and update custom roles and permission configurations",
  },
  "departments:manage": {
    label: "Manage departments",
    group: "Administration",
    description: "Create, rename, and delete workspace departments",
  },
  "workspace:manage": {
    label: "Manage workspace",
    group: "Administration",
    description: "Manage organization workspace profile and overall settings",
  },
  "analytics:view": {
    label: "View analytics",
    group: "Analytics",
    description: "View search queries, user trends, and document analytics",
  },
};

function getPermissionMeta(permission) {
  if (PERMISSION_DETAILS[permission]) {
    return PERMISSION_DETAILS[permission];
  }
  return {
    label: permission
      .split(":")
      .map((p) => p.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()))
      .join(" — "),
    group: "Other",
    description: "",
  };
}

export default function RoleManagement() {
  const { user } = useAuth();
  const isOrgOwner = user?.is_owner ?? false;
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deletingRole, setDeletingRole] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const manageableDepartments = departments.filter(
    (department) =>
      isOrgOwner ||
      (user?.permissions?.includes("departments:manage") &&
        user?.department_ids?.includes(department.id))
  );
  const editingRole = roles.find((role) => role.id === draft.id);
  const roleScopeLocked = Boolean(
    editingRole && (editingRole.member_count || editingRole.document_count)
  );

  const load = useCallback(async () => {
    try {
      const [result, departmentResult] = await Promise.all([
        getOrganizationRoles(),
        getDepartments(),
      ]);
      setRoles(result.roles || []);
      setPermissions(result.permissions || []);
      setDepartments(departmentResult.departments ?? (Array.isArray(departmentResult) ? departmentResult : []));
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function togglePermission(permission) {
    setDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));
  }

  function toggleAllInGroup(groupPermissions, shouldSelect) {
    setDraft((current) => {
      const remaining = current.permissions.filter((p) => !groupPermissions.includes(p));
      return {
        ...current,
        permissions: shouldSelect ? [...remaining, ...groupPermissions] : remaining,
      };
    });
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (draft.id) {
        await updateOrganizationRole(draft.id, {
          name: draft.name,
          permissions: draft.permissions,
          scope: draft.scope,
          department_id: draft.scope === "department" ? draft.department_id : null,
        });
        setNotice(`Role "${draft.name}" updated successfully.`);
      } else {
        await createOrganizationRole({
          name: draft.name,
          permissions: draft.permissions,
          scope: draft.scope,
          department_id: draft.scope === "department" ? draft.department_id : null,
        });
        setNotice(`Role "${draft.name}" created successfully.`);
      }
      setDraft(emptyDraft);
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  function requestDelete(role) {
    if (!isOrgOwner) {
      setError("Only the organization Owner can delete roles.");
      return;
    }
    setDeleteConfirm(role);
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    setDeletingRole(deleteConfirm.id);
    setError("");
    setNotice("");
    try {
      await deleteOrganizationRole(deleteConfirm.id);
      setNotice(`Role "${deleteConfirm.name}" deleted.`);
      setDeleteConfirm(null);
      await load();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeletingRole(null);
    }
  }

  function cancelDelete() {
    setDeleteConfirm(null);
  }

  const groupedPermissions = permissions.reduce((acc, permission) => {
    const meta = getPermissionMeta(permission);
    if (!acc[meta.group]) acc[meta.group] = [];
    acc[meta.group].push({ permission, ...meta });
    return acc;
  }, {});

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-xl text-ink">Organization roles & permissions</h1>
        <p className="text-sm text-slate">
          Create roles and configure exactly what permissions each role has — including managing departments, documents, users, and integrations.
        </p>
      </div>

      {/* Global Alerts */}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-hairline bg-paper-raised px-4 py-3 text-sm text-danger"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-md border border-hairline bg-paper-raised px-4 py-3 text-sm text-success"
        >
          {notice}
        </div>
      )}

      {/* Create / Edit Role Card */}
      <Card className="p-6">
        <form onSubmit={save} className="flex flex-col gap-5">
          <div className="border-b border-hairline pb-2">
            <h2 className="font-medium text-ink">
              {draft.id ? `Edit role: ${draft.name}` : "Create a new role"}
            </h2>
            <p className="text-xs text-slate">
              Define the role name and select the permissions granted to members with this role.
            </p>
          </div>
          {editingRole?.scope_review_required && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This legacy role is quarantined until the organization Owner explicitly confirms its scope.
              Reassign all users and document grants before resolving it.
            </div>
          )}

          <label className="flex max-w-md flex-col gap-1 text-sm text-ink-soft">
            Role name
            <input
              required
              maxLength={48}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="e.g. Department Lead, Research Associate, Auditor"
              className="rounded-md border border-hairline bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-slate-light focus:border-index focus:outline-none"
            />
          </label>

          <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-ink-soft">
              Role scope
              <select
                className="rounded-md border border-hairline bg-paper-raised px-3 py-2 text-sm text-ink"
                value={draft.scope}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    scope: event.target.value,
                    department_id: event.target.value === "organization" ? "" : draft.department_id,
                  })
                }
                disabled={roleScopeLocked}
              >
                <option
                  value="organization"
                  disabled={!isOrgOwner && user?.role_scope === "department"}
                >
                  Organization-wide
                </option>
                <option
                  value="department"
                  disabled={!isOrgOwner && !user?.permissions?.includes("departments:manage")}
                >
                  Department-specific
                </option>
              </select>
            </label>
            {draft.scope === "department" && (
              <label className="flex flex-col gap-1 text-sm text-ink-soft">
                Department
                <select
                  required
                  className="rounded-md border border-hairline bg-paper-raised px-3 py-2 text-sm text-ink"
                  value={draft.department_id}
                  onChange={(event) => setDraft({ ...draft, department_id: event.target.value })}
                  disabled={roleScopeLocked}
                >
                  <option value="">Select a department</option>
                  {manageableDepartments.map((department) => (
                    <option key={department.id} value={department.id}>{department.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Grouped Permissions */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">Role permissions</span>
              <span className="text-xs text-slate">
                {draft.permissions.length} of {permissions.length} permissions enabled
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {Object.entries(groupedPermissions).map(([groupName, items]) => {
                const allSelected = items.every((i) => draft.permissions.includes(i.permission));

                return (
                  <div
                    key={groupName}
                    className="rounded-lg border border-hairline bg-paper-raised/40 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between border-b border-hairline pb-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                        {groupName}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          toggleAllInGroup(
                            items.map((i) => i.permission),
                            !allSelected
                          )
                        }
                        className="text-[11px] font-medium text-index hover:underline"
                      >
                        {allSelected ? "Deselect all" : "Select all"}
                      </button>
                    </div>

                    <div className="flex flex-col gap-2.5">
                      {items.map(({ permission, label, description }) => {
                        const isChecked = draft.permissions.includes(permission);
                        return (
                          <label
                            key={permission}
                            className={`flex cursor-pointer items-start gap-2.5 rounded-md p-1.5 transition-colors hover:bg-paper-raised ${
                              isChecked ? "bg-paper-raised/60" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => togglePermission(permission)}
                              className="mt-0.5 h-4 w-4 rounded accent-index"
                            />
                            <div className="flex flex-col">
                              <span className="text-xs font-medium text-ink">
                                {label}
                              </span>
                              {description && (
                                <span className="text-[11px] leading-tight text-slate">
                                  {description}
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-3">
            <Button type="submit" disabled={saving || !draft.name.trim()}>
              {saving ? "Saving…" : draft.id ? "Save role changes" : "Create role"}
            </Button>
            {draft.id && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDraft(emptyDraft)}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>

      {/* Roles List Card */}
      <Card className="divide-y divide-hairline overflow-hidden">
        <div className="border-b border-hairline px-5 py-3">
          <h2 className="text-sm font-medium text-ink">Existing organization roles</h2>
        </div>

        {loading ? (
          <p className="p-6 text-sm text-slate">Loading roles…</p>
        ) : roles.length === 0 ? (
          <p className="p-6 text-sm text-slate">No roles defined yet.</p>
        ) : (
          roles.map((role) => (
            <div
              key={role.id}
              className="flex flex-wrap items-start justify-between gap-4 p-5 transition-colors hover:bg-paper-raised/30"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-sm text-ink">{role.name}</h3>
                  {role.is_owner && (
                    <span className="rounded bg-role-admin/10 px-2 py-0.5 text-xs font-medium text-role-admin">
                      Protected Owner
                    </span>
                  )}
                  {role.scope_review_required && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                      Owner review required
                    </span>
                  )}
                </div>

                <p className="mt-1 text-xs text-slate">
                  {role.scope === "department"
                    ? `Department-specific · ${role.department?.name || "Department"} · `
                    : "Organization-wide · "}
                  {role.member_count} member{role.member_count === 1 ? "" : "s"}
                </p>

                {/* Permissions Badges */}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {role.permissions.length === 0 ? (
                    <span className="text-xs italic text-slate-light">
                      No permissions granted
                    </span>
                  ) : (
                    role.permissions.map((perm) => {
                      const meta = getPermissionMeta(perm);
                      return (
                        <span
                          key={perm}
                          className="rounded px-2 py-0.5 text-[11px] font-medium bg-paper-raised text-ink-soft border border-hairline"
                          title={meta.description || meta.label}
                        >
                          {meta.label}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              {!role.is_owner && (
                <div className="flex items-center gap-2 pt-1">
                  {(!role.scope_review_required || isOrgOwner) &&
                    (role.scope !== "department" ||
                    isOrgOwner ||
                    (user?.permissions?.includes("departments:manage") &&
                      user?.department_ids?.includes(role.department_id))) && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-3 py-1 text-xs"
                      onClick={() => {
                        setDraft({
                          id: role.id,
                          name: role.name,
                          permissions: role.permissions,
                          scope: role.scope || "organization",
                          department_id: role.department_id || "",
                        });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Edit
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    className={`px-3 py-1 text-xs hover:text-danger ${
                      !isOrgOwner ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                    onClick={() => requestDelete(role)}
                    disabled={!isOrgOwner}
                  >
                    {deletingRole === role.id ? "Deleting…" : "Delete"}
                  </Button>
                  {!isOrgOwner && (
                    <span className="text-[11px] text-slate-light">Owner only</span>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </Card>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="flex w-full max-w-sm flex-col gap-4 p-6 shadow-xl">
            <h2 className="font-display text-lg text-ink">Delete role?</h2>
            <p className="text-sm text-ink-soft">
              Are you sure you want to delete the role{" "}
              <strong>{deleteConfirm.name}</strong>?
            </p>
            {deleteConfirm.member_count > 0 && (
              <div className="rounded-md border border-hairline bg-paper-raised p-3 text-xs text-danger">
                This role is assigned to {deleteConfirm.member_count} user
                {deleteConfirm.member_count === 1 ? "" : "s"}. Reassign them before deleting it.
              </div>
            )}
            {deleteConfirm.document_count > 0 && (
              <div className="rounded-md border border-hairline bg-paper-raised p-3 text-xs text-danger">
                This role grants access to {deleteConfirm.document_count} document
                {deleteConfirm.document_count === 1 ? "" : "s"}. Reassign the document permissions before deleting it.
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={cancelDelete}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={confirmDelete}
                disabled={
                  deletingRole === deleteConfirm.id ||
                  deleteConfirm.member_count > 0 ||
                  deleteConfirm.document_count > 0
                }
              >
                {deletingRole === deleteConfirm.id
                  ? "Deleting…"
                  : deleteConfirm.member_count > 0 || deleteConfirm.document_count > 0
                  ? "Reassign first"
                  : "Delete role"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
