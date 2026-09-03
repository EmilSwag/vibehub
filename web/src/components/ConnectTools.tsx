import { useCallback, useEffect, useMemo, useState } from "react";
import { usersApi } from "../lib/api";
import type { TrackerStatus, TrackerToken } from "../types";
import { Button } from "./ui/Button";
import { Skeleton } from "./ui/Skeleton";
import styles from "./ConnectTools.module.css";

type Os = "mac" | "windows";

const WEB_URL = window.location.origin;

/** Tools the tracker understands today, with what it can see for each. */
const SUPPORTED = [
  { id: "claude_code", name: "Claude Code", sees: "tokens · model · project · time" },
  { id: "codex", name: "Codex CLI", sees: "tokens · project · time" },
  { id: "cursor", name: "Cursor", sees: "project · time" },
  { id: "vscode", name: "VS Code", sees: "project · time" },
  { id: "quadcode", name: "Quadcode", sees: "project · time" },
];

const TOOL_NAMES: Record<string, string> = Object.fromEntries(SUPPORTED.map((t) => [t.id, t.name]));
// Tracker adapters report kebab-case ("claude-code"); older builds used snake_case.
const toolLabel = (id: string): string => TOOL_NAMES[id.replace(/-/g, "_")] ?? TOOL_NAMES[id] ?? id;

function detectOs(): Os {
  return /Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent) ? "windows" : "mac";
}

function installCommand(os: Os, token: string): string {
  return os === "windows"
    ? `$env:VIBEHUB_TOKEN="${token}"; irm ${WEB_URL}/tracker/install.ps1 | iex`
    : `curl -fsSL ${WEB_URL}/tracker/install.sh | bash -s -- ${token}`;
}

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

interface Props {
  /** Compact = onboarding/banner density; full = Settings (shows device list). */
  variant?: "compact" | "full";
  /** Fires the first time we observe a live heartbeat. */
  onConnected?: () => void;
}

/**
 * The one place that explains *how* VibeHub learns what you're doing:
 * a tiny local tracker reads your AI tools' logs, sends heartbeats, and this
 * card flips to "Connected" on the first one. Polls every 5s while waiting.
 */
export function ConnectTools({ variant = "compact", onConnected }: Props) {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokens, setTokens] = useState<TrackerToken[]>([]);
  const [os, setOs] = useState<Os>(detectOs);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await usersApi.trackerStatus();
      setStatus((prev) => {
        if (!prev?.connected && s.connected) onConnected?.();
        return s;
      });
    } catch {
      /* transient — keep the last known state */
    }
  }, [onConnected]);

  useEffect(() => {
    void refresh();
    if (variant === "full") {
      usersApi.listTrackerTokens().then((r) => setTokens(r.tokens)).catch(() => undefined);
    }
  }, [refresh, variant]);

  // Poll only while disconnected: the user is watching this card, waiting.
  useEffect(() => {
    if (status?.connected) return;
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [status?.connected, refresh]);

  const createToken = async () => {
    setCreating(true);
    setError(null);
    try {
      const label = `${os === "windows" ? "Windows" : "Mac"} · ${new Date().toLocaleDateString()}`;
      const res = await usersApi.createTrackerToken(label);
      setToken(res.token);
      if (variant === "full") {
        const list = await usersApi.listTrackerTokens();
        setTokens(list.tokens);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a token");
    } finally {
      setCreating(false);
    }
  };

  const command = useMemo(() => (token ? installCommand(os, token) : null), [os, token]);

  const copy = async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copy failed — select the command and copy it manually.");
    }
  };

  const revoke = async (id: string) => {
    await usersApi.revokeTrackerToken(id);
    setTokens((prev) => prev.filter((t) => t.id !== id));
  };

  if (!status) {
    return (
      <div className={cx(styles.card, styles.cardLoading)} aria-busy="true">
        <Skeleton width="40%" height={14} />
        <Skeleton width="90%" height={12} />
        <Skeleton width="70%" height={12} />
      </div>
    );
  }

  const osSegment = (
    <div className={styles.seg} role="tablist" aria-label="Operating system">
      {(["mac", "windows"] as Os[]).map((o) => (
        <button
          key={o}
          type="button"
          role="tab"
          aria-selected={os === o}
          className={cx(styles.segBtn, os === o && styles.segBtnOn)}
          onClick={() => setOs(o)}
        >
          {o === "mac" ? "macOS / Linux" : "Windows"}
        </button>
      ))}
    </div>
  );

  const commandBlock = (
    <div className={styles.cmdRow}>
      <code className={styles.cmd}>{command ?? installCommand(os, "<your-token>")}</code>
      <Button size="sm" variant="secondary" onClick={copy} disabled={!command}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );

  return (
    <div className={cx(styles.card, status.connected && styles.cardConnected)}>
      <div className={styles.head}>
        <span className={cx(styles.dot, status.connected && styles.dotLive)} aria-hidden="true" />
        <div className={styles.headText}>
          <strong className={styles.headTitle}>
            {status.connected ? "Tracker connected" : "Connect your tools"}
          </strong>
          <span className={styles.headSub}>
            {status.connected
              ? status.tools.length
                ? `Seeing ${status.tools.map(toolLabel).join(", ")}`
                : "Waiting for your first AI session…"
              : "A tiny local tracker turns your AI sessions into status, time and token stats."}
          </span>
        </div>
      </div>

      {!status.connected && (
        <>
          <ol className={styles.steps}>
            <li>
              <span className={styles.stepNo}>1</span>
              <div className={styles.stepBody}>
                <span>Create a device token</span>
                {token ? (
                  <code className={styles.token}>{token}</code>
                ) : (
                  <div>
                    <Button size="sm" onClick={createToken} disabled={creating}>
                      {creating ? "Creating…" : "Create token"}
                    </Button>
                  </div>
                )}
              </div>
            </li>
            <li className={cx(!token && styles.stepMuted)}>
              <span className={styles.stepNo}>2</span>
              <div className={styles.stepBody}>
                <div className={styles.osRow}>
                  <span>Run this in your terminal</span>
                  {osSegment}
                </div>
                {commandBlock}
                <span className={styles.hint}>Needs Node.js 18+. Nothing else to install.</span>
              </div>
            </li>
            <li className={cx(!token && styles.stepMuted)}>
              <span className={styles.stepNo}>3</span>
              <div className={styles.stepBody}>
                <span>Keep working — this card flips to Connected on the first heartbeat.</span>
                {token && (
                  <span className={styles.waiting}>
                    <span className={styles.pulse} aria-hidden="true" /> Listening…
                  </span>
                )}
              </div>
            </li>
          </ol>

          <div className={styles.tools}>
            {SUPPORTED.map((t) => (
              <div key={t.id} className={styles.tool}>
                <span className={styles.toolName}>{t.name}</span>
                <span className={styles.toolSees}>{t.sees}</span>
              </div>
            ))}
          </div>
          <p className={styles.privacy}>
            Only metadata leaves your machine: tool, model, project name, timestamps, token counts.
            Never code, prompts or diffs.
          </p>
        </>
      )}

      {status.connected && variant === "full" && (
        <div className={styles.tokens}>
          <span className={styles.tokensTitle}>Devices</span>
          {tokens.length === 0 ? (
            <span className={styles.hint}>No active tokens.</span>
          ) : (
            tokens.map((t) => (
              <div key={t.id} className={styles.tokenRow}>
                <span>{t.label}</span>
                <span className={styles.hint}>
                  {t.lastUsedAt ? `seen ${new Date(t.lastUsedAt).toLocaleString()}` : "never used"}
                </span>
                <button type="button" className={styles.revoke} onClick={() => revoke(t.id)}>
                  Revoke
                </button>
              </div>
            ))
          )}
          <div className={styles.addRow}>
            <Button size="sm" variant="secondary" onClick={createToken} disabled={creating}>
              Add another device
            </Button>
            {token && osSegment}
          </div>
          {token && <code className={styles.token}>{token}</code>}
          {token && commandBlock}
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
