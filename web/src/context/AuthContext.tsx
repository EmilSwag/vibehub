import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { authApi } from "../lib/api";
import type { User } from "../types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  devLogin: (username: string) => Promise<void>;
  completeOAuth: (ticket: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Replace the cached user after a PATCH /users/me or onboarding step. */
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await authApi.me();
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ticket = new URLSearchParams(window.location.search).get("oauth");
    if (ticket) {
      // LoginPage claims the ticket; a parallel /me would race and wipe the user.
      setLoading(false);
      return;
    }
    refresh();
  }, [refresh]);

  const devLogin = useCallback(async (username: string) => {
    const { user } = await authApi.devLogin(username);
    setUser(user);
  }, []);

  const completeOAuth = useCallback(async (ticket: string) => {
    const { user } = await authApi.claim(ticket);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, devLogin, completeOAuth, logout, refresh, setUser }),
    [user, loading, devLogin, completeOAuth, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
