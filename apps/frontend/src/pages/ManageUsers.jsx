import { mockUsers } from "../mocks/queryResults";
import Card from "../components/ui/Card";
import { RoleBadge } from "../components/ui/Badge";
import Avatar from "../components/ui/Avatar";

export default function ManageUsers() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-xl text-ink">Manage users</h1>
        <p className="text-sm text-slate">
          Admin-only. Assign roles and manage workspace access.
        </p>
      </div>

      <Card className="divide-y divide-hairline">
        {mockUsers.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={u.name} size="sm" />
            <div className="flex flex-1 flex-col">
              <span className="text-sm font-medium text-ink">{u.name}</span>
              <span className="text-xs text-slate">{u.department}</span>
            </div>
            <RoleBadge role={u.role} />
          </div>
        ))}
      </Card>
    </div>
  );
}
