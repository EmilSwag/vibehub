import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { RealtimeProvider } from "./context/RealtimeContext";
import { captureConnectDeepLink } from "./lib/connectDeepLink";
import { initTheme } from "./lib/theme";
import "./styles/tokens.css";
import "./styles/motion.css";

// Re-applies the saved theme (index.html already did, pre-paint) and starts
// cross-tab sync. Before render so the first frame is never the wrong theme.
initTheme();

// `/?connect=1` from the menu-bar app. Before render, because the router rewrites the
// URL and ProtectedRoute drops the query when it bounces a logged-out visitor to /login.
captureConnectDeepLink();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <RealtimeProvider>
          <App />
        </RealtimeProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
