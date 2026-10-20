import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { navForRole } from "./lib/nav";
import DashboardLayout from "./layouts/DashboardLayout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Search from "./pages/Search";
import Upload from "./pages/Upload";
import ManageUsers from "./pages/ManageUsers";
import WorkspaceSettings from "./pages/WorkspaceSettings";
import Integrations from "./pages/Integrations";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-sm text-slate">Loading…</div>;
  return user ? children : <Navigate to="/login" replace />;
}

function RequireRole({ path, children }) {
  const { user } = useAuth();
  const allowed = navForRole(user.role).some((item) => item.path === path);
  return allowed ? children : <Navigate to="/app/search" replace />;
}

// Google OAuth lands the browser on /integrations?connected=google, but the
// real page lives at /app/integrations — forward it with params intact.
function IntegrationsRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/app/integrations${search}`} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
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
        <Route
          path="integrations"
          element={
            <RequireRole path="/app/integrations">
              <Integrations />
            </RequireRole>
          }
        />
      </Route>
      {/* The Google OAuth callback redirects to /integrations (top level) —
          forward it into the app while preserving the query params. */}
      <Route path="/integrations" element={<IntegrationsRedirect />} />
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