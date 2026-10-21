import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { navForUser } from "./lib/nav";
import DashboardLayout from "./layouts/DashboardLayout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Search from "./pages/Search";
import Upload from "./pages/Upload";
import ManageUsers from "./pages/ManageUsers";
import WorkspaceSettings from "./pages/WorkspaceSettings";
import Integrations from "./pages/Integrations";
import RoleManagement from "./pages/RoleManagement";
import AccountSettings from "./pages/AccountSettings";
import Analytics from "./pages/Analytics";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-sm text-slate">Loading…</div>;
  return user ? children : <Navigate to="/login" replace />;
}

function RequirePermission({ path, children }) {
  const { user } = useAuth();
  const allowed = navForUser(user).some((item) => item.path === path);
  const fallback = navForUser(user)[0]?.path || "/app/account";
  return allowed ? children : <Navigate to={fallback} replace />;
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
        <Route index element={<Navigate to="account" replace />} />
        <Route
          path="search"
          element={<RequirePermission path="/app/search"><Search /></RequirePermission>}
        />
        <Route
          path="upload"
          element={
            <RequirePermission path="/app/upload">
              <Upload />
            </RequirePermission>
          }
        />
        <Route
          path="users"
          element={
            <RequirePermission path="/app/users">
              <ManageUsers />
            </RequirePermission>
          }
        />
        <Route
          path="roles"
          element={
            <RequirePermission path="/app/roles">
              <RoleManagement />
            </RequirePermission>
          }
        />
        <Route
          path="analytics"
          element={
            <RequirePermission path="/app/analytics">
              <Analytics />
            </RequirePermission>
          }
        />
        <Route
          path="settings"
          element={
            <RequirePermission path="/app/settings">
              <WorkspaceSettings />
            </RequirePermission>
          }
        />
        <Route
          path="integrations"
          element={
            <RequirePermission path="/app/integrations">
              <Integrations />
            </RequirePermission>
          }
        />
        <Route path="account" element={<AccountSettings />} />
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