import { useState } from "react";
import { API_BASE, usersApi } from "../../lib/api";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import styles from "./PublishFromAI.module.css";

/**
 * Lets an AI agent publish on the user's behalf. We mint a device token (same
 * kind the tracker uses) and hand the user a prompt that teaches the agent the
 * one endpoint it needs. No SDK, no plugin — any tool that can run curl works.
 */
export function PublishFromAI() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"prompt" | "token" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiBase = API_BASE || window.location.origin;
  const tokenValue = token ?? "<paste your VibeHub token>";

  const prompt = [
    "You can publish the project we're working on to my VibeHub profile.",
    "",
    "When I say \"publish to VibeHub\", do this:",
    "1. Write a short name (≤80 chars) and a 1–2 sentence description of what we built and which tools we used.",
    "2. Use the git remote URL as repoUrl if this is a GitHub repo; add liveUrl if we have a deployed URL.",
    "3. POST it:",
    "",
    `curl -X POST ${apiBase}/api/v1/projects \\`,
    `  -H "Authorization: Bearer ${tokenValue}" \\`,
    '  -H "Content-Type: application/json" \\',
    "  -d '{\"name\":\"...\",\"description\":\"...\",\"repoUrl\":\"https://github.com/...\",\"liveUrl\":\"https://...\",\"isPublic\":true}'",
    "",
    "4. If we have screenshots, attach them (up to 8 image files, field name `files`):",
    "",
    `curl -X POST ${apiBase}/api/v1/projects/<id-from-step-3>/images \\`,
    `  -H "Authorization: Bearer ${tokenValue}" \\`,
    '  -F "files=@./shot1.png" -F "files=@./shot2.png"',
    "",
    "Show me the name and description before posting. Never print the token back to me.",
  ].join("\n");

  async function mint() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await usersApi.createTrackerToken("AI publish");
      setToken(res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a token");
    } finally {
      setBusy(false);
    }
  }

  async function copy(kind: "prompt" | "token") {
    const text = kind === "prompt" ? prompt : token ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1600);
    } catch {
      setError("Clipboard blocked — select the text and copy manually.");
    }
  }

  return (
    <section className={styles.card} aria-labelledby="publish-ai-title">
      <button
        type="button"
        className={styles.head}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={styles.headIcon}>
          <Icon name="sparkles" size={18} />
        </span>
        <span className={styles.headText}>
          <span id="publish-ai-title" className={styles.title}>
            Publish from Claude, Codex or any AI
          </span>
          <span className={styles.sub}>
            Paste one prompt into your agent — it posts the project for you, screenshots included.
          </span>
        </span>
        <Icon name="plus" size={16} className={[styles.chev, open && styles.chevOpen].filter(Boolean).join(" ")} />
      </button>

      {open && (
        <div className={styles.body}>
          <ol className={styles.steps}>
            <li>
              <span className={styles.num}>1</span>
              <div className={styles.stepBody}>
                <span className={styles.stepTitle}>Create a personal token</span>
                {token ? (
                  <div className={styles.tokenRow}>
                    <code className={styles.token}>{token}</code>
                    <Button type="button" variant="secondary" size="sm" onClick={() => copy("token")}>
                      <Icon name={copied === "token" ? "check" : "copy"} size={14} />
                      {copied === "token" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                ) : (
                  <div className={styles.tokenRow}>
                    <Button type="button" size="sm" onClick={mint} disabled={busy}>
                      {busy ? "Creating…" : "Create token"}
                    </Button>
                    <span className={styles.note}>Shown once. Revoke anytime in Settings → Tracker.</span>
                  </div>
                )}
              </div>
            </li>
            <li>
              <span className={styles.num}>2</span>
              <div className={styles.stepBody}>
                <span className={styles.stepTitle}>Paste this into your agent</span>
                <div className={styles.promptWrap}>
                  <pre className={styles.prompt}>{prompt}</pre>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className={styles.copyPrompt}
                    onClick={() => copy("prompt")}
                  >
                    <Icon name={copied === "prompt" ? "check" : "copy"} size={14} />
                    {copied === "prompt" ? "Copied" : "Copy prompt"}
                  </Button>
                </div>
                {!token && <span className={styles.note}>Create the token first so it's filled in for you.</span>}
              </div>
            </li>
            <li>
              <span className={styles.num}>3</span>
              <div className={styles.stepBody}>
                <span className={styles.stepTitle}>Say “publish to VibeHub”</span>
                <span className={styles.note}>
                  The card appears here and on your profile; GitHub pushes show up automatically. Agents can
                  create and edit posts — deleting stays here, in the app.
                </span>
              </div>
            </li>
          </ol>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}
    </section>
  );
}
