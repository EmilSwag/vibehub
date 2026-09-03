import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { AppLayout } from "./layout/AppLayout";
import { PageTransition } from "./ui/PageTransition";

/**
 * Signed-in shell. A fresh account (onboardedAt === null) is routed through the
 * 4-step onboarding before it sees any app screen; the onboarding route itself is
 * rendered bare (no nav) so the wizard owns the whole viewport.
 */
export function ProtectedRoute({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const needsOnboarding = !user.onboardedAt;
  const onOnboarding = location.pathname.startsWith("/onboarding");

  if (needsOnboarding && !onOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }
  if (!needsOnboarding && onOnboarding) {
    return <Navigate to="/" replace />;
  }

  if (bare) {
    return <>{children}</>;
  }

  return (
    <AppLayout>
      <PageTransition>{children}</PageTransition>
    </AppLayout>
  );
}
