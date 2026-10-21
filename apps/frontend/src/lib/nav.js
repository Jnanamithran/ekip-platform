export const NAV_ITEMS = [
  {
    label: "Search",
    path: "/app/search",
    permissions: ["documents:search"],
  },
  {
    label: "Documents",
    path: "/app/upload",
    permissions: ["documents:upload", "documents:delete", "documents:reindex", "documents:manage_access"],
  },
  {
    label: "Manage Users",
    path: "/app/users",
    permissions: ["users:manage"],
  },
  {
    label: "Manage Roles",
    path: "/app/roles",
    permissions: ["roles:manage"],
  },
  {
    label: "Integrations",
    path: "/app/integrations",
    permissions: ["drive:connect", "drive:import"],
  },
  {
    label: "Workspace Settings",
    path: "/app/settings",
    permissions: ["workspace:manage"],
  },
  {
    label: "Analytics",
    path: "/app/analytics",
    permissions: ["analytics:view"],
  },
  {
    label: "Account",
    path: "/app/account",
    permissions: [],
  },
];

export function navForUser(user) {
  return NAV_ITEMS.filter(
    (item) =>
      !item.permissions.length ||
      user?.is_owner ||
      item.permissions.some((permission) => user?.permissions?.includes(permission))
  );
}
