import { useCallback, useEffect, useState } from "react";
import {
  createAdminUser,
  getOrganizationRoles,
  getAdminUsers,
  getDepartments,
  updateAdminUser,
  resetUserPassword,
  setUserActive,
} from "../lib/apiClient";
import Card from "../components/ui/Card";
import Badge, { RoleBadge } from "../components/ui/Badge";
import Avatar from "../components/ui/Avatar";
import { useAuth } from "../lib/AuthContext";

const linkBtn =
  "text-xs font-medium text-index hover:underline disabled:opacity-50";
const fieldCls =
  "rounded-md border border-hairline bg-white px-2 py-1.5 text-sm text-ink";

export default function ManageUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ email: "", role_id: "", department_id: "" });
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    role_id: "",
    department_id: "",
  });
  const [tempPw, setTempPw] = useState(null); // { email, password }
  const [copied, setCopied] = useState(false);

  const deptName = useCallback(
    (id) => departments.find((d) => d.id === id)?.name ?? id,
    [departments]
  );
  const assignableRoles = roles.filter(
    (role) =>
      !role.is_owner &&
      (currentUser?.is_owner ||
        role.permissions.every((permission) => currentUser?.permissions?.includes(permission)))
  );

  const load = useCallback(async () => {
    try {
      const [usersData, rolesData] = await Promise.all([
        getAdminUsers(),
        getOrganizationRoles(),
      ]);
      setUsers(usersData.users ?? []);
      setRoles(rolesData.roles ?? []);
      setNewUser((current) => ({
        ...current,
        role_id: current.role_id || rolesData.roles.find((role) =>
          !role.is_owner &&
          (currentUser?.is_owner ||
            role.permissions.every((permission) => currentUser?.permissions?.includes(permission)))
        )?.id || "",
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    load();
    getDepartments()
      .then((d) => setDepartments(d.departments ?? (Array.isArray(d) ? d : [])))
      .catch((err) => setError(err.message));
  }, [load]);

  // Runs an action for one user, with shared busy/error handling
  async function run(user, fn) {
    setBusyId(user.id);
    setNotice("");
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(user) {
    setEditingId(user.id);
    setForm({
      email: user.email,
      role_id: user.role_id,
      department_id: user.department_id ?? "",
    });
  }

  function saveEdit(user) {
    // Only send fields that actually changed
    const body = {};
    if (form.email.trim().toLowerCase() !== user.email) body.email = form.email.trim();
    if (form.role_id !== user.role_id) body.role_id = form.role_id;
    if (form.department_id && form.department_id !== user.department_id) {
      body.department_id = form.department_id;
    }

    if (!Object.keys(body).length) {
      setEditingId(null);
      return;
    }
    run(user, async () => {
      const { user: updated } = await updateAdminUser(user.id, body);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...updated } : u)));
      setEditingId(null);
      setNotice("User updated.");
    });
  }

  async function createUser(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusyId("new-user");
    try {
      const { user: created } = await createAdminUser(newUser);
      setUsers((previous) => [created, ...previous]);
      setNewUser({
        email: "",
        password: "",
        role_id: assignableRoles[0]?.id || "",
        department_id: "",
      });
      setNotice("User created.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function toggleActive(user) {
    const makeActive = user.active === false;
    if (
      !makeActive &&
      !window.confirm(`Deactivate ${user.email}? They will be signed out.`)
    ) {
      return;
    }
    run(user, async () => {
      await setUserActive(user.id, makeActive);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, active: makeActive } : u))
      );
      setNotice(makeActive ? "User reactivated." : "User deactivated.");
    });
  }

  function resetPw(user) {
    if (
      !window.confirm(
        `Reset password for ${user.email}? They will be signed out and need the new temporary password.`
      )
    ) {
      return;
    }
    run(user, async () => {
      const data = await resetUserPassword(user.id);
      setCopied(false);
      setTempPw({ email: user.email, password: data.temp_password });
    });
  }

  async function copyPw() {
    try {
      await navigator.clipboard.writeText(tempPw.password);
      setCopied(true);
    } catch {
      setError("Could not copy. Select and copy the password manually.");
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-xl text-ink">Manage users</h1>
        <p className="text-sm text-slate">
          Create organization-specific roles, assign them to users, and manage their accounts.
        </p>
      </div>

      {notice && <p className="text-sm text-index">{notice}</p>}
      {error && !loading && (
        <p className="text-sm text-danger">{error}</p>
      )}

      <Card className="p-4">
        <form onSubmit={createUser} className="grid gap-3 sm:grid-cols-2">
          <h2 className="text-sm font-medium text-ink sm:col-span-2">Add a user</h2>
          <input
            required
            type="email"
            placeholder="Email address"
            className={fieldCls}
            value={newUser.email}
            onChange={(event) => setNewUser({ ...newUser, email: event.target.value })}
          />
          <input
            required
            type="password"
            placeholder="Temporary password"
            className={fieldCls}
            value={newUser.password}
            onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
          />
          <select
            required
            className={fieldCls}
            value={newUser.role_id}
            onChange={(event) => setNewUser({ ...newUser, role_id: event.target.value })}
          >
            <option value="">Select a role</option>
            {assignableRoles.map((role) => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </select>
          <select
            required
            className={fieldCls}
            value={newUser.department_id}
            onChange={(event) => setNewUser({ ...newUser, department_id: event.target.value })}
          >
            <option value="">Select a department</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
          <button
            className={`${linkBtn} justify-self-start`}
            type="submit"
            disabled={busyId === "new-user" || !assignableRoles.length || !departments.length}
          >
            {busyId === "new-user" ? "Creating…" : "Create user"}
          </button>
          {!assignableRoles.length && (
            <p className="text-xs text-slate sm:col-span-2">
              Create a role with Manage Roles before adding users.
            </p>
          )}
        </form>
      </Card>

      <Card className="divide-y divide-hairline">
        {loading ? (
          <p className="px-4 py-6 text-sm text-slate">Loading users...</p>
        ) : users.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate">No users found.</p>
        ) : (
          users.map((user) => {
            const inactive = user.active === false;
            const busy = busyId === user.id;
            const editing = editingId === user.id;
            return (
              <div key={user.id} className="flex flex-col gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={user.email} size="sm" />
                  <div className="flex flex-1 flex-col">
                    <span
                      className={`text-sm font-medium ${inactive ? "text-slate" : "text-ink"}`}
                    >
                      {user.email}
                    </span>
                    <span className="text-xs text-slate">
                      {deptName(user.department_id)}
                    </span>
                  </div>
                  {inactive && <Badge>Inactive</Badge>}
                  <RoleBadge role={user.role} />
                </div>

                {editing ? (
                  <div className="flex flex-col gap-2 pl-10">
                    <input
                      className={fieldCls}
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                    <div className="flex gap-2">
                      <select
                        className={fieldCls}
                        value={form.role_id}
                        disabled={user.id === currentUser?.user_id}
                        onChange={(e) => setForm({ ...form, role_id: e.target.value })}
                      >
                        {assignableRoles.map((role) => (
                          <option key={role.id} value={role.id}>{role.name}</option>
                        ))}
                      </select>
                      <select
                        className={`${fieldCls} flex-1`}
                        value={form.department_id}
                        onChange={(e) =>
                          setForm({ ...form, department_id: e.target.value })
                        }
                      >
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-3">
                      <button className={linkBtn} disabled={busy} onClick={() => saveEdit(user)}>
                        Save
                      </button>
                      <button className={linkBtn} onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : !user.role_is_owner && user.id !== currentUser?.user_id ? (
                    <div className="flex gap-4 pl-10">
                      <button className={linkBtn} disabled={busy} onClick={() => startEdit(user)}>
                        Edit
                      </button>
                      <button className={linkBtn} disabled={busy} onClick={() => resetPw(user)}>
                        Reset password
                      </button>
                      <button className={linkBtn} disabled={busy} onClick={() => toggleActive(user)}>
                        {inactive ? "Reactivate" : "Deactivate"}
                      </button>
                    </div>
                  ) : null}
              </div>
            );
          })
        )}
      </Card>

      {tempPw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="flex w-full max-w-sm flex-col gap-3 p-5">
            <h2 className="font-display text-lg text-ink">Temporary password</h2>
            <p className="text-sm text-slate">
              For {tempPw.email}. Share it securely. It will not be shown again.
            </p>
            <code className="select-all break-all rounded-md border border-hairline px-3 py-2 text-sm text-ink">
              {tempPw.password}
            </code>
            <div className="flex gap-3">
              <button className={linkBtn} onClick={copyPw}>
                {copied ? "Copied" : "Copy"}
              </button>
              <button className={linkBtn} onClick={() => setTempPw(null)}>
                Done
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}