import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { protectedRouteDecision, rememberLoginReturn } from "../lib/loginReturn";
import { AppLayout } from "./layout/AppLayout";
import { PageTransition } from "./ui/PageTransition";

/**
 * Signed-in shell. A fresh account (onboardedAt === null) is routed through the
 * 4-step onboarding before it sees any app screen; the onboarding route itself is
 * rendered bare (no nav) so the wizard owns the whole viewport. /pair is the one
 * exception: a new user must be able to approve their first device mid-setup.
 * The decision itself lives in lib/loginReturn.ts (pinned by its check).
 */
export function ProtectedRoute({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return null;
  }

  const decision = protectedRouteDecision({
    signedIn: Boolean(user),
    onboarded: Boolean(user?.onboardedAt),
    pathname: location.pathname,
    search: location.search,
    bare,
  });

  if (decision.to === "login") {
    // Idempotent sessionStorage write, so a StrictMode double render is harmless.
    if (decision.remember) rememberLoginReturn(decision.remember);
    return <Navigate to="/login" replace />;
  }
  if (decision.to === "onboarding") {
    return <Navigate to="/onboarding" replace />;
  }
  if (decision.to === "home") {
    return <Navigate to="/" replace />;
  }

  if (decision.bare) {
    return <>{children}</>;
  }

  return (
    <AppLayout>
      <PageTransition>{children}</PageTransition>
    </AppLayout>
  );
}
