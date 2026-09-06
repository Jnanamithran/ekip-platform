import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { navForRole } from "./lib/nav";
import DashboardLayout from "./layouts/DashboardLayout";
import Login from "./pages/Login";
import Search from "./pages/Search";
import Upload from "./pages/Upload";
import ManageUsers from "./pages/ManageUsers";
import WorkspaceSettings from "./pages/WorkspaceSettings";

/** Redirects to /login if not signed in. */
function RequireAuth({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

/**
 * Redirects to /app/search if the current role isn't allowed on
 * this route — e.g. an Intern hitting /app/users directly via URL.
 * Nav already hides these links, but a direct URL should still be
 * blocked; RBAC has to hold at the route level, not just the nav.
 */
function RequireRole({ path, children }) {
  const { user } = useAuth();
  const allowed = navForRole(user.role).some((item) => item.path === path);
  return allowed ? children : <Navigate to="/app/search" replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <DashboardLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="search" replace />} />
        <Route path="search" element={<Search />} />
        <Route
          path="upload"
          element={
            <RequireRole path="/app/upload">
              <Upload />
            </RequireRole>
          }
        />
        <Route
          path="users"
          element={
            <RequireRole path="/app/users">
              <ManageUsers />
            </RequireRole>
          }
        />
        <Route
          path="settings"
          element={
            <RequireRole path="/app/settings">
              <WorkspaceSettings />
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
