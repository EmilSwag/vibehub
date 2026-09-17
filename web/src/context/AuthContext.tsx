import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { authApi } from "../lib/api";
import { authGeneration, beginAuthenticatedSession, createAuthQueue, expireAuthSession, isCurrentAuth, onAuthBoundary } from "../lib/authSession";
import type { User } from "../types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  generation: number;
  devLogin: (username: string) => Promise<void>;
  completeOAuth: (ticket: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Replace this session's cached user after a PATCH or onboarding step. */
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(authGeneration);
  const userRef = useRef<User | null>(null);
  const mounted = useRef(true);
  const refreshSequence = useRef(0);
  const authAction = useRef(0);
  const pendingLogin = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const enqueueAuth = useMemo(createAuthQueue, []);

  useLayoutEffect(() => {
    mounted.current = true;
    const off = onAuthBoundary((reason) => {
      if (reason !== "expired") return;
      refreshSequence.current += 1;
      userRef.current = null;
      setUserState(null);
      setGeneration(authGeneration());
      setLoading(false);
    });
    return () => {
      mounted.current = false;
      refreshSequence.current += 1;
      off();
    };
  }, []);

  const commitUser = useCallback((next: User, newLogin = false) => {
    // Initial /me hydration preserves this account's saved connect instructions.
    // A different account, or a new login to the same account, starts a new scope.
    if (newLogin || (userRef.current && userRef.current.id !== next.id)) {
      setGeneration(beginAuthenticatedSession());
    }
    userRef.current = next;
    setUserState(next);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current || !isCurrentAuth(generation)) return;
    const sequence = ++refreshSequence.current;
    const current = () => mounted.current && sequence === refreshSequence.current && isCurrentAuth(generation);
    try {
      const { user: next } = await authApi.me(AbortSignal.timeout(8000));
      if (!current()) return;
      if (next) commitUser(next);
      else expireAuthSession(generation);
    } catch {
      // Network/5xx/403 cannot prove sign-out. HTTP401 is handled by the client.
    } finally {
      if (current()) setLoading(false);
    }
  }, [generation, commitUser]);

  useEffect(() => {
    const ticket = new URLSearchParams(window.location.search).get("oauth");
    if (ticket) {
      // LoginPage claims the ticket; a parallel /me would race the exchange.
      setLoading(false);
    } else {
      void refresh();
    }
    // Initial hydration only. Subsequent refreshes are explicit, not login side effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const authenticate = useCallback((kind: "dev" | "oauth", credential: string): Promise<void> => {
    const key = `${kind}:${credential}`;
    // React StrictMode can ask for the same one-time ticket twice in one mount.
    if (pendingLogin.current?.key === key) return pendingLogin.current.promise;
    const action = ++authAction.current;
    refreshSequence.current += 1;
    const run = enqueueAuth(async () => {
      // Serialize every cookie-writing request, not just login after logout. A late
      // first login must not replace the second account or undo an explicit logout.
      if (!mounted.current || action !== authAction.current) return;
      const { user: next } = await (kind === "dev" ? authApi.devLogin(credential) : authApi.claim(credential));
      if (mounted.current && action === authAction.current) commitUser(next, true);
    });
    pendingLogin.current = { key, promise: run };
    void run.finally(() => {
      if (pendingLogin.current?.promise === run) pendingLogin.current = null;
      if (mounted.current && action === authAction.current) setLoading(false);
    }).catch(() => undefined);
    return run;
  }, [commitUser, enqueueAuth]);

  const devLogin = useCallback((username: string) => authenticate("dev", username), [authenticate]);
  const completeOAuth = useCallback((ticket: string) => authenticate("oauth", ticket), [authenticate]);

  const logout = useCallback(async () => {
    // A callback retained by a previous account cannot sign the new account out.
    if (generation !== authGeneration()) return;
    authAction.current += 1;
    pendingLogin.current = null;
    // Leave private UI now. Remote logout waits for any in-flight login, so its
    // cookie cannot arrive after logout; the next login waits for this request too.
    expireAuthSession(generation);
    await enqueueAuth(() => authApi.logout()).catch(() => undefined);
  }, [generation, enqueueAuth]);

  const setUser = useCallback((next: User | null) => {
    // A saved callback from an old page must not repopulate an expired/new session.
    if (!isCurrentAuth(generation)) return;
    if (!next) { expireAuthSession(generation); return; }
    if (next.id !== userRef.current?.id) return;
    commitUser(next);
  }, [generation, commitUser]);

  const value = useMemo(
    () => ({ user, loading, generation, devLogin, completeOAuth, logout, refresh, setUser }),
    [user, loading, generation, devLogin, completeOAuth, logout, refresh, setUser]
  );

  return (
    <AuthContext.Provider value={value}>
      {/* Reset private page state, pending instructions and realtime caches together,
          before another account can render them. Profile edits keep the same key. */}
      <Fragment key={`${generation}:${user?.id ?? "signed-out"}`}>{children}</Fragment>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
