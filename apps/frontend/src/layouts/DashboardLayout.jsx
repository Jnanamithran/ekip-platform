import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { navForRole } from "../lib/nav";
import Avatar from "../components/ui/Avatar";
import { RoleBadge } from "../components/ui/Badge";

const ALL_ROLES = ["Admin", "Manager", "Employee", "Intern"];

export default function DashboardLayout() {
  const { user, switchRole, logout } = useAuth();
  const navigate = useNavigate();

  // RequireAuth (in App.jsx) already guarantees `user` exists before
  // this layout renders — this is just a defensive fallback, not the
  // primary guard, so it never calls navigate() during render.
  if (!user) return null;

  const items = navForRole(user.role);

  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="flex w-60 shrink-0 flex-col border-r border-hairline bg-paper-raised">
        <div className="px-5 py-5">
          <span className="font-display text-lg text-ink">EKIP</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-index-soft text-index"
                    : "text-slate hover:bg-paper hover:text-ink"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-hairline p-3">
          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-slate hover:bg-paper hover:text-danger"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-hairline bg-paper-raised px-6 py-3">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-ink">{user.name}</span>
              <span className="text-xs text-slate">{user.department}</span>
            </div>
            <RoleBadge role={user.role} />
          </div>

          {/* DEMO-ONLY control — lets you show RBAC differences live
              without logging in and out four times. Remove once
              real auth (v0.3) makes this unnecessary. */}
          <label className="flex items-center gap-2 text-xs text-slate-light">
            Demo: view as
            <select
              value={user.role}
              onChange={(e) => switchRole(e.target.value)}
              className="rounded-md border border-hairline bg-paper px-2 py-1 text-xs text-ink"
            >
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
        </header>

        <main className="flex-1 px-6 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
