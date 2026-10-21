import { useAuth } from "../lib/AuthContext";
import { useCallback, useEffect, useState } from "react";
import {
  createOrganizationRole,
  deleteOrganizationRole,
  getOrganizationRoles,
  updateOrganizationRole,
} from "../lib/apiClient";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";

const emptyDraft = { id: null, name: "", permissions: [] };

function permissionLabel(permission) {
  return permission.split(":").map((part) =>
    part.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  ).join(" — ");
}

export default function RoleManagement() {
  const { user } = useAuth();
  const isOrgOwner = user?.is_owner ?? false;
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deletingRole, setDeletingRole] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const load = useCallback(async () => {
    try {
      const result = await getOrganizationRoles();
      setRoles(result.roles);
      setPermissions(result.permissions);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
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
        });
        setNotice("Role updated.");
      } else {
        await createOrganizationRole({
          name: draft.name,
          permissions: draft.permissions,
        });
        setNotice("Role created.");
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
      const result = await deleteOrganizationRole(deleteConfirm.id);
      const removed = result.removed_users ?? [];
      setNotice(
        `Role "${deleteConfirm.name}" deleted.` +
        (removed.length
          ? ` ${removed.length} user${removed.length === 1 ? "" : "s"} with this role were removed from the organization: ${removed.join(", ")}.`
          : "")
      );
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

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="font-display text-xl text-ink">Organization roles</h1>
        <p className="text-sm text-slate">
          Create roles for your organization and choose what each role can do. The Owner role is protected — only the Owner can delete roles.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}
      <Card className="p-5">
        <form onSubmit={save} className="flex flex-col gap-4">
          <h2 className="text-sm font-medium text-ink">{draft.id ? "Edit role" : "Create a role"}</h2>
          <label className="flex flex-col gap-1 text-sm text-ink-soft">
            Role name
            <input
              required
              maxLength={48}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className="rounded-md border border-hairline bg-white px-3 py-2"
            />
          </label>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium text-ink-soft">Permissions</legend>
            {permissions.map((permission) => (
              <label key={permission} className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  checked={draft.permissions.includes(permission)}
                  onChange={() => togglePermission(permission)}
                />
                {permissionLabel(permission)}
              </label>
            ))}
          </fieldset>
          <div className="flex gap-3">
            <Button type="submit" disabled={saving || !draft.name.trim()}>
              {saving ? "Saving…" : draft.id ? "Save changes" : "Create role"}
            </Button>
            {draft.id && (
              <button type="button" className="text-sm text-slate" onClick={() => setDraft(emptyDraft)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </Card>
      <Card className="divide-y divide-hairline">
        {loading ? (
          <p className="p-4 text-sm text-slate">Loading roles…</p>
        ) : roles.map((role) => (
          <div key={role.id} className="flex flex-wrap items-start gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-ink">{role.name}</h2>
                {role.is_owner && <span className="text-xs text-index">Protected Owner</span>}
              </div>
              <p className="mt-1 text-xs text-slate">
                {role.member_count} member{role.member_count === 1 ? "" : "s"} ·{" "}
                {role.permissions.length ? role.permissions.map(permissionLabel).join(", ") : "No permissions"}
              </p>
            </div>
            {!role.is_owner && (
              <div className="flex gap-3">
                <button
                  type="button"
                  className="text-xs font-medium text-index hover:underline"
                  onClick={() => setDraft({
                    id: role.id,
                    name: role.name,
                    permissions: role.permissions,
                  })}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={`text-xs font-medium text-danger hover:underline ${!isOrgOwner ? "opacity-50 cursor-not-allowed" : ""}`}
                  onClick={() => requestDelete(role)}
                  disabled={!isOrgOwner}
                >
                  {deletingRole === role.id ? "Deleting…" : "Delete"}
                </button>
                {!isOrgOwner && (
                  <span className="text-xs text-slate">Owner only</span>
                )}
              </div>
            )}
          </div>
        ))}
      </Card>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="flex w-full max-w-sm flex-col gap-4 p-6">
            <h2 className="font-display text-lg text-ink">Delete role?</h2>
            <p className="text-sm text-ink-soft">
              Are you sure you want to delete the role <strong>{deleteConfirm.name}</strong>?
            </p>
            {deleteConfirm.member_count > 0 && (
              <div className="bg-index-soft/50 border border-index-soft rounded p-3 mb-3">
                <p className="text-sm text-danger">
                  <strong>Warning:</strong> {deleteConfirm.member_count} user{deleteConfirm.member_count === 1 ? "" : "s"} currently have this role. They will be <strong>removed from the organization</strong>.
                </p>
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                className="text-sm text-slate hover:underline"
                onClick={cancelDelete}
              >
                Cancel
              </button>
              <button
                type="button"
                className="text-sm font-medium text-danger"
                onClick={confirmDelete}
                disabled={deletingRole === deleteConfirm.id}
              >
                {deletingRole === deleteConfirm.id ? "Deleting…" : "Delete role"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
