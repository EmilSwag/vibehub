// Route table. Build order and screen list: ../docs/BUILD_PLAN.md §5.
// REST/WS contract every screen renders against, verbatim: ../docs/ARCHITECTURE.md §5.

import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ScrollToTop } from "./components/ScrollToTop";
import { AppLayout } from "./components/layout/AppLayout";
import { PageTransition } from "./components/ui/PageTransition";
import { RouteFallback } from "./components/ui/RouteFallback";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { ProfilePage } from "./pages/ProfilePage";

// Per-route chunks (meta/plans/vibehub-honest-achievements-feed.md, B7). Login, Home
// and the public profile stay in the entry bundle — they are the first paint for a
// visitor, a returning user and a shared link respectively. Everything else loads
// when its route is opened; the pages export named components, hence the `.then`.
const FriendsPage = lazy(() => import("./pages/FriendsPage").then((m) => ({ default: m.FriendsPage })));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage").then((m) => ({ default: m.ProjectsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const ProjectPage = lazy(() => import("./pages/ProjectPage").then((m) => ({ default: m.ProjectPage })));
const PairPage = lazy(() => import("./pages/PairPage").then((m) => ({ default: m.PairPage })));
const OnboardingPage = lazy(() =>
  import("./pages/onboarding/OnboardingPage").then((m) => ({ default: m.OnboardingPage }))
);

export default function App() {
  return (
    <>
      {/* Every PUSH/REPLACE navigation lands at the top of the new page; back
          and forward keep the offset the visitor left behind. */}
      <ScrollToTop />

      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* First-run wizard: signed-in, but rendered without the app nav. Its chunk
            arrives against a bare viewport, so the fallback is nothing rather than a
            skeleton of a shape the wizard does not have. */}
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute bare>
              <Suspense fallback={null}>
                <OnboardingPage />
              </Suspense>
            </ProtectedRoute>
          }
        />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          }
        />
        {/* Lazy pages sit inside ProtectedRoute's PageTransition, so the reveal plays
            once over the skeleton and the page then fills it in without a second run. */}
        <Route
          path="/friends"
          element={
            <ProtectedRoute>
              <Suspense fallback={<RouteFallback />}>
                <FriendsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects"
          element={
            <ProtectedRoute>
              <Suspense fallback={<RouteFallback />}>
                <ProjectsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Suspense fallback={<RouteFallback />}>
                <SettingsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/pair"
          element={
            <ProtectedRoute>
              <Suspense fallback={<RouteFallback />}>
                <PairPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        {/* Public: a signed-out visitor can open a profile page (round 9), same
            shape as /p/:id below — the server gates private/friends-only detail,
            not the route. Not behind ProtectedRoute. */}
        <Route
          path="/u/:username"
          element={
            <AppLayout>
              <PageTransition>
                <ProfilePage />
              </PageTransition>
            </AppLayout>
          }
        />

        {/* Public: a signed-out visitor can open a public project's page (round 5).
            Not behind ProtectedRoute — the server itself gates private projects. */}
        <Route
          path="/p/:id"
          element={
            <AppLayout>
              <PageTransition>
                <Suspense fallback={<RouteFallback />}>
                  <ProjectPage />
                </Suspense>
              </PageTransition>
            </AppLayout>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
