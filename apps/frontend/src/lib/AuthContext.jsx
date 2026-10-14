import { createContext, useContext, useEffect, useState } from "react";
import * as api from "./apiClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // true until we've checked whether an existing refresh token can
  // restore a session — App.jsx must wait on this before redirecting
  // anyone to /login, or a valid session gets kicked out on reload.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!api.getRefreshToken()) {
        setLoading(false);
        return;
      }
      try {
        setUser(await api.restoreSession());
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function doLogin(email, password) {
    await api.login(email, password);
    const me = await api.getMe();
    setUser(me);
    return me;
  }

  async function doLogout() {
    await api.logout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login: doLogin, logout: doLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}