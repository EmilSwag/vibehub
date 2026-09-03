import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { authApi, githubLoginUrl } from "../lib/api";
import type { AuthCapabilities } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { FieldLabel, Input } from "../components/ui/Input";
import buttonStyles from "../components/ui/Button.module.css";
import styles from "./LoginPage.module.css";

export function LoginPage() {
  const { user, loading, devLogin, completeOAuth } = useAuth();
  const [username, setUsername] = useState("");
  // The GitHub round-trip ends on the server, so it reports failures by bouncing back
  // to /login?error=… — pick that up as the initial error instead of silently
  // dropping the user on a fresh-looking login screen.
  const [error, setError] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("error")
  );
  const [submitting, setSubmitting] = useState(false);
  const [claiming, setClaiming] = useState(
    () => Boolean(new URLSearchParams(window.location.search).get("oauth"))
  );
  // Which sign-in methods the server has configured. Until the probe answers we show the
  // GitHub button (the default path); the username form only appears when the server
  // says DEV_LOGIN_ENABLED — never based on the web build mode alone.
  const [caps, setCaps] = useState<AuthCapabilities>({ github: true, devLogin: import.meta.env.DEV });

  useEffect(() => {
    let cancelled = false;
    authApi
      .capabilities()
      .then((c) => {
        if (!cancelled) setCaps(c);
      })
      .catch(() => {
        /* keep defaults — server unreachable is surfaced by the sign-in attempt itself */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const ticket = new URLSearchParams(window.location.search).get("oauth");
    if (!ticket) return;
    let cancelled = false;
    completeOAuth(ticket)
      .then(() => {
        window.history.replaceState({}, "", "/login");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "GitHub sign-in failed. Try again.");
        setClaiming(false);
        window.history.replaceState({}, "", "/login");
      });
    return () => {
      cancelled = true;
    };
  }, [completeOAuth]);

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  const showGithub = caps.github;
  const showUsername = caps.devLogin;
  const usernameLabel = showGithub ? "dev only" : "sign in with a username";

  async function handleDevLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await devLogin(username.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dev login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <div className={styles.mark} />
        <h1 className={styles.title}>Welcome to VibeHub</h1>
        <p className={styles.subtitle}>Steam, for people who ship with an AI pair.</p>

        {error && <p className={styles.error}>{error}</p>}

        {claiming && <p className={styles.subtitle}>Signing in…</p>}

        {!claiming && showGithub && (
          <a
            href={githubLoginUrl()}
            className={[buttonStyles.btn, buttonStyles.primary, styles.githubBtn].join(" ")}
          >
            Continue with GitHub
          </a>
        )}

        {!claiming && showUsername && (
          <>
            {showGithub && <div className={styles.divider}>{usernameLabel}</div>}
            <form className={styles.devForm} onSubmit={handleDevLogin}>
              <FieldLabel htmlFor="dev-username">
                {showGithub ? "Dev login username" : "Pick a username (letters, digits, - or _)"}
              </FieldLabel>
              <Input
                id="dev-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ada"
                autoFocus={!showGithub}
                required
              />
              <Button
                type="submit"
                variant={showGithub ? "secondary" : "primary"}
                disabled={submitting || !username.trim()}
              >
                {submitting ? "Signing in…" : showGithub ? "Dev sign in" : "Sign in"}
              </Button>
            </form>
          </>
        )}

        {!claiming && !showGithub && !showUsername && (
          <p className={styles.error}>
            This server has no sign-in method configured. Set GITHUB_CLIENT_ID/SECRET or
            DEV_LOGIN_ENABLED=true on the server.
          </p>
        )}
      </Card>
    </div>
  );
}
