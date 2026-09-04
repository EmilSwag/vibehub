import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE, usersApi } from "../lib/api";
import { buildConnectPrompt } from "../lib/connectPrompt";
import { elapsedShort, formatDateTime, formatShortDate, toolLabel } from "../lib/format";
import { useExitTransition } from "../lib/motion";
import type { ConnectPromptTarget } from "../lib/connectPrompt";
import type { TrackerStatus, TrackerToken } from "../types";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Skeleton } from "./ui/Skeleton";
import { ConnectSuccessModal } from "./ui/ConnectSuccessModal";
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

// Shown once per browser session, on either surface (Home banner or Settings) —
// whichever notices the connection first. Also covers landing on an already-
// connected account (no live "flip" to catch), since the check is level- not
// edge-triggered: "is connected, haven't celebrated yet" rather than "just changed".
const CELEBRATED_KEY = "vh-connect-celebrated";

/** The three targets `buildConnectPrompt` knows how to write for (round 5: Home flow). */
const TARGETS: { id: ConnectPromptTarget; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "chatgpt", label: "ChatGPT" },
];

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
  /** compact = onboarding (always visible); banner = Home (hides itself once
   * connected, with an exit transition); full = Settings (shows device list).
   * compact and banner render identically otherwise. */
  variant?: "compact" | "banner" | "full";
  /** Fires the first time we observe a live heartbeat. */
  onConnected?: () => void;
}

/**
 * The one place that explains *how* VibeHub learns what you're doing:
 * a tiny local tracker reads your AI tools' logs, sends heartbeats, and this
 * card flips to "Connected" on the first one. Polls every 5s while waiting.
 */
export function ConnectTools({ variant = "compact", onConnected }: Props) {
  const { user } = useAuth();
  const { presences } = useRealtime();
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokens, setTokens] = useState<TrackerToken[]>([]);
  const [os, setOs] = useState<Os>(detectOs);
  const [target, setTarget] = useState<ConnectPromptTarget>("claude-code");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);

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

  // Level-triggered on purpose (see CELEBRATED_KEY comment above) — fires once
  // per session the moment `connected` is true and hasn't been shown yet.
  useEffect(() => {
    if (!status?.connected) return;
    if (sessionStorage.getItem(CELEBRATED_KEY)) return;
    sessionStorage.setItem(CELEBRATED_KEY, "1");
    setCelebrating(true);
  }, [status?.connected]);

  const me = user ? presences.get(user.username) : undefined;
  const celebrateBody =
    me?.status === "active" && me.activity
      ? `${me.activity.projectAlias} · ${toolLabel(me.activity.tool)} · ${elapsedShort(me.activity.startedAt)}`
      : "Waiting for the first heartbeat.";

  const createToken = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const label = `${os === "windows" ? "Windows" : "Mac"} · ${formatShortDate(new Date().toISOString())}`;
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
  }, [os, variant]);

  // compact/banner: skip the button — mint the token the moment we know the
  // tracker isn't connected, so step 2's prompt is ready to copy immediately.
  useEffect(() => {
    if (variant === "full" || !status || status.connected || token || creating) return;
    void createToken();
  }, [variant, status, token, creating, createToken]);

  // Home only: hide once connected, with an exit transition instead of vanishing.
  const showCard = variant !== "banner" || !status?.connected;
  const { render: renderCard, closing: cardClosing } = useExitTransition(showCard, 260);

  const command = useMemo(() => (token ? installCommand(os, token) : null), [os, token]);
  const prompt = useMemo(
    () => (token ? buildConnectPrompt(target, token, API_BASE, WEB_URL) : null),
    [token, target]
  );

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copy failed — select the text and copy it manually.");
    }
  };

  const revoke = async (id: string) => {
    await usersApi.revokeTrackerToken(id);
    setTokens((prev) => prev.filter((t) => t.id !== id));
  };

  if (!status) {
    return (
      <div
        className={cx(styles.card, styles.cardLoading, variant === "banner" && styles.bannerSpacing)}
        aria-busy="true"
      >
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
      <Button size="sm" variant="secondary" onClick={() => command && copy(command)} disabled={!command}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );

  if (!renderCard) {
    return (
      <ConnectSuccessModal open={celebrating} body={celebrateBody} onClose={() => setCelebrating(false)} />
    );
  }

  return (
    <>
    <div
      className={cx(
        styles.card,
        status.connected && styles.cardConnected,
        variant === "banner" && styles.bannerSpacing,
        variant === "banner" && (cardClosing ? "leave" : "reveal")
      )}
    >
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
                : "Waiting for your first session…"
              : variant !== "full"
                ? "Paste a prompt into your AI tool — no terminal needed."
                : "A tiny local tracker turns your AI sessions into status, time and token stats."}
          </span>
        </div>
      </div>

      {!status.connected && variant !== "full" && (
        <>
          <ol className={styles.steps}>
            <li>
              <span className={styles.stepNo}>1</span>
              <div className={styles.stepBody}>
                <span>Where are you working?</span>
                <div className={styles.seg} role="tablist" aria-label="AI tool">
                  {TARGETS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={target === t.id}
                      className={cx(styles.segBtn, target === t.id && styles.segBtnOn)}
                      onClick={() => setTarget(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </li>
            <li className={cx(!prompt && styles.stepMuted)}>
              <span className={styles.stepNo}>2</span>
              <div className={styles.stepBody}>
                <span>Paste this into {TARGETS.find((t) => t.id === target)?.label}</span>
                {prompt ? (
                  <div className={styles.promptWrap}>
                    <pre className={styles.prompt}>{prompt}</pre>
                    <Button
                      size="sm"
                      variant="secondary"
                      className={styles.copyPrompt}
                      onClick={() => copy(prompt)}
                    >
                      <Icon name={copied ? "check" : "copy"} size={13} />
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                ) : (
                  <Skeleton height={54} width="100%" />
                )}
              </div>
            </li>
            <li className={cx(!prompt && styles.stepMuted)}>
              <span className={styles.stepNo}>3</span>
              <div className={styles.stepBody}>
                <span>Keep working — this flips to Connected on the first heartbeat.</span>
                {prompt && (
                  <span className={styles.waiting}>
                    <span className={styles.pulse} aria-hidden="true" /> Listening…
                  </span>
                )}
              </div>
            </li>
          </ol>
        </>
      )}

      {!status.connected && variant === "full" && (
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
                  {t.lastUsedAt ? `seen ${formatDateTime(t.lastUsedAt)}` : "never used"}
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
    <ConnectSuccessModal
      open={celebrating}
      body={celebrateBody}
      onClose={() => setCelebrating(false)}
    />
    </>
  );
}
