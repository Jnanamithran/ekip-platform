import { createContext, useContext, useState } from "react";
import { mockUsers } from "../mocks/queryResults";

const AuthContext = createContext(null);

/**
 * MOCK auth only — no real backend yet (that's v0.3). Holds the
 * "logged in" user in memory and exposes switchRole() purely so
 * we can demo RBAC differences live without four separate logins.
 * Replace login()'s body with a real POST /auth/login in v0.3;
 * the shape consumers use (user, login, logout) should stay stable.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  function login(email) {
    // Demo-only: match by email prefix against mock users, or
    // default to the first (Admin) so the login form always works.
    const match =
      mockUsers.find((u) =>
        u.name.toLowerCase().startsWith(email.split("@")[0].toLowerCase())
      ) ?? mockUsers[0];
    setUser(match);
    return match;
  }

  function logout() {
    setUser(null);
  }

  function switchRole(role) {
    const match = mockUsers.find((u) => u.role === role);
    if (match) setUser(match);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, switchRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
