import { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import Card from "../components/ui/Card";
import { RoleBadge } from "../components/ui/Badge";
import Avatar from "../components/ui/Avatar";

export default function ManageUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch("/admin/users")
      .then((data) => setUsers(data.users ?? []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-xl text-ink">Manage users</h1>
        <p className="text-sm text-slate">
          Admin-only. Assign roles and manage workspace access.
        </p>
      </div>

      {loading && (
        <p className="text-sm text-slate">Loading users…</p>
      )}

      {error && (
        <p className="text-sm text-danger">Failed to load users: {error}</p>
      )}

      {!loading && !error && (
        <Card className="divide-y divide-hairline">
          {users.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate">
              No users found.
            </div>
          )}
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={u.name ?? u.email} size="sm" />
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-medium text-ink">{u.name ?? u.email}</span>
                <span className="text-xs text-slate">{u.department ?? u.department_id}</span>
              </div>
              <RoleBadge role={u.role} />
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
