import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { navForUser } from "../lib/nav";
import Avatar from "../components/ui/Avatar";
import { RoleBadge } from "../components/ui/Badge";

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // RequireAuth (in App.jsx) already guarantees `user` exists before
  // this layout renders — this is just a defensive fallback, not the
  // primary guard, so it never calls navigate() during render.
  if (!user) return null;

  const items = navForUser(user);

  return (
    <div className="flex h-dvh overflow-hidden bg-paper">
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-hairline bg-paper-raised">
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-hairline bg-paper-raised px-6 py-3">
          <div className="flex items-center gap-3">
            <Avatar name={user.email || user.name} />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-ink">{user.email || user.name}</span>
              <span className="text-xs text-slate">{user.department || "Department"}</span>
            </div>
            <RoleBadge role={user.role} />
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto px-6 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
