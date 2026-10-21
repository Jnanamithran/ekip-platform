const ROLE_STYLES = {
  Owner: "bg-role-admin/10 text-role-admin border-role-admin/25",
  Admin: "bg-role-admin/10 text-role-admin border-role-admin/25",
  Manager: "bg-role-manager/10 text-role-manager border-role-manager/25",
  Employee: "bg-role-employee/10 text-role-employee border-role-employee/25",
  Intern: "bg-role-intern/10 text-role-intern border-role-intern/25",
};

export function RoleBadge({ role }) {
  const style = ROLE_STYLES[role] ?? "bg-index-soft text-index border-index/25";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5
        text-xs font-medium ${style}`}
    >
      {role}
    </span>
  );
}

export default function Badge({ children, className = "" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-index-soft
        px-2.5 py-0.5 text-xs font-medium text-index ${className}`}
    >
      {children}
    </span>
  );
}
