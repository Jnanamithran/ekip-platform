import { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import Card from "../components/ui/Card";
import { RoleBadge } from "../components/ui/Badge";
import Avatar from "../components/ui/Avatar";

export default function ManageUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    apiFetch("/admin/users")
      .then((data) => {
        if (active) setUsers(data.users ?? []);
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
        <h1 className="font-display text-xl text-ink">Manage users</h1>
        <p className="text-sm text-slate">
          Admin-only. Assign roles and manage workspace access.
        </p>
      </div>

      <Card className="divide-y divide-hairline">
        {loading ? (
          <p className="px-4 py-6 text-sm text-slate">Loading users…</p>
        ) : error ? (
          <p className="px-4 py-6 text-sm text-danger">Failed to load users: {error}</p>
        ) : users.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate">No users found.</p>
        ) : (
          users.map((user) => (
            <div key={user.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={user.name ?? user.email} size="sm" />
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-medium text-ink">{user.name ?? user.email}</span>
                <span className="text-xs text-slate">
                  {user.department ?? user.department_id}
                </span>
              </div>
              <RoleBadge role={user.role} />
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
