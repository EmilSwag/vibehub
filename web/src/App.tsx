// Route table. Build order and screen list: ../docs/BUILD_PLAN.md §5.
// REST/WS contract every screen renders against, verbatim: ../docs/ARCHITECTURE.md §5.

import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ScrollToTop } from "./components/ScrollToTop";
import { AppLayout } from "./components/layout/AppLayout";
import { PageTransition } from "./components/ui/PageTransition";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { ProfilePage } from "./pages/ProfilePage";
import { ProjectPage } from "./pages/ProjectPage";
import { FriendsPage } from "./pages/FriendsPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { OnboardingPage } from "./pages/onboarding/OnboardingPage";

export default function App() {
  return (
    <>
      {/* Every PUSH/REPLACE navigation lands at the top of the new page; back
          and forward keep the offset the visitor left behind. */}
      <ScrollToTop />

      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* First-run wizard: signed-in, but rendered without the app nav. */}
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute bare>
              <OnboardingPage />
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
        <Route
          path="/friends"
          element={
            <ProtectedRoute>
              <FriendsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects"
          element={
            <ProtectedRoute>
              <ProjectsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/u/:username"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />

        {/* Public: a signed-out visitor can open a public project's page (round 5).
            Not behind ProtectedRoute — the server itself gates private projects. */}
        <Route
          path="/p/:id"
          element={
            <AppLayout>
              <PageTransition>
                <ProjectPage />
              </PageTransition>
            </AppLayout>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
