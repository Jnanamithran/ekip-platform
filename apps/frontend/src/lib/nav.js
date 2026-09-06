// Single source of truth for which roles see which nav items.
// Keeping this in one file (instead of scattered role checks in
// components) means RBAC UI logic is auditable at a glance —
// useful when Jnani asks "who can see what" in review.
export const NAV_ITEMS = [
  {
    label: "Search",
    path: "/app/search",
    roles: ["Admin", "Manager", "Employee", "Intern"],
  },
  {
    label: "Upload Documents",
    path: "/app/upload",
    roles: ["Admin", "Manager", "Employee"],
  },
  {
    label: "Manage Users",
    path: "/app/users",
    roles: ["Admin"],
  },
  {
    label: "Workspace Settings",
    path: "/app/settings",
    roles: ["Admin"],
  },
];

export function navForRole(role) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
