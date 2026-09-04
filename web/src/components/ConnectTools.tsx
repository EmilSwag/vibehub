import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, usersApi } from "../lib/api";
import { buildConnectPrompt, buildInstallCommand } from "../lib/connectPrompt";
import type { ConnectPromptTarget, InstallOs } from "../lib/connectPrompt";
import {
  clearStoredConnectToken,
  dropForeignConnectTokens,
  ensureConnectToken,
  hasSeenTracking,
  markTrackingSeen,
  readStoredConnectToken,
} from "../lib/connectToken";
import type { StoredConnectToken } from "../lib/connectToken";
import { formatShortDate, presenceLine } from "../lib/format";
import { useExitTransition } from "../lib/motion";
import type { TrackerStatus } from "../types";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";
import { Skeleton } from "./ui/Skeleton";
import { ConnectSuccessModal } from "./ui/ConnectSuccessModal";
import { DeviceList, TrackingStatus } from "./TrackingStatus";
import { useNow } from "./ui/PresenceBlock";
import styles from "./ConnectTools.module.css";

const WEB_URL = window.location.origin;

// Shown once per browser session, on either surface (Home banner or Settings) —
// whichever notices the connection first. Level-triggered ("is connected and
// hasn't been celebrated yet") so a connection made on another page still gets
// its moment here; gated below so a returning, already-explained account isn't
// congratulated again every new tab.
const CELEBRATED_KEY = "vh-connect-celebrated";

const POLL_WAITING_MS = 5_000;
const POLL_CONNECTED_MS = 10_000;
const EXIT_MS = 260;

/** The three targets `buildConnectPrompt` knows how to write for. */
const TARGETS: { id: ConnectPromptTarget; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "chatgpt", label: "ChatGPT" },
];

const OSES: { id: InstallOs; label: string }[] = [
  { id: "mac", label: "macOS / Linux" },
  { id: "windows", label: "Windows" },
];

type Copyable = "prompt" | "command" | "token";
type Phase = "loading" | "waiting" | "connected";

function detectOs(): InstallOs {
  return /Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent) ? "windows" : "mac";
}

function deviceLabel(os: InstallOs): string {
  return `${os === "windows" ? "Windows" : "Mac"} · ${formatShortDate(new Date().toISOString())}`;
}

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/* ---- Segmented control (target / OS) ---- */

function Segment<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className={styles.seg} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          className={cx(styles.segBtn, value === o.id && styles.segBtnOn)}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---- Manual install: token + OS-segmented one-liner ---- */

function ManualInstall({
  token,
  os,
  onOs,
  copied,
  onCopy,
}: {
  token: string;
  os: InstallOs;
  onOs: (os: InstallOs) => void;
  copied: Copyable | null;
  onCopy: (what: Copyable, text: string) => void;
}) {
  const command = buildInstallCommand(os, token, API_BASE, WEB_URL);
  return (
    <div className={cx(styles.manual, "fade-in")}>
      <div className={styles.osRow}>
        <span className={styles.manualLabel}>Run in your terminal</span>
        <Segment label="Operating system" options={OSES} value={os} onChange={onOs} />
      </div>
      <div className={styles.cmdRow}>
        <code className={styles.cmd}>{command}</code>
        <Button size="sm" variant="secondary" onClick={() => onCopy("command", command)}>
          {copied === "command" ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className={styles.tokenRow}>
        <code className={styles.token}>{token}</code>
        <button type="button" className={styles.link} onClick={() => onCopy("token", token)}>
          {copied === "token" ? "Copied" : "Copy token"}
        </button>
      </div>
      <span className={styles.hint}>Needs Node.js 18+.</span>
    </div>
  );
}

/* ---- ConnectTools ---- */

interface Props {
  /** compact = onboarding (always visible); banner = Home (hides itself once
   * connected and explained, with exit transitions); full = Settings (lists
   * devices in both states). */
  variant?: "compact" | "banner" | "full";
  /** Fires the first time we observe a live heartbeat. */
  onConnected?: () => void;
}

/**
 * One component, two states. Not connected → the connect card (one primary
 * path: pick a tool, copy the prompt, wait for the first heartbeat). Connected →
 * TrackingStatus (what got connected, is it tracking). This wrapper owns the
 * status poll (5s while waiting, 10s while the connected panel is on screen),
 * reacts instantly to the viewer's own presence pushes, mints the device token
 * exactly once per browser (lib/connectToken), and fires the one-time success
 * modal.
 */
export function ConnectTools({ variant = "compact", onConnected }: Props) {
  const { user } = useAuth();
  const { presences } = useRealtime();
  const userId = user?.id ?? null;
  const isBanner = variant === "banner";

  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [connectToken, setConnectToken] = useState<StoredConnectToken | null>(null);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [addingDevice, setAddingDevice] = useState(false);
  const [os, setOs] = useState<InstallOs>(detectOs);
  const [target, setTarget] = useState<ConnectPromptTarget>("claude-code");
  const [manual, setManual] = useState(false);
  const [copied, setCopied] = useState<Copyable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [seen, setSeen] = useState(() => (userId ? hasSeenTracking(userId) : false));

  const phase: Phase = status ? (status.connected ? "connected" : "waiting") : "loading";
  const connected = phase === "connected";

  const refresh = useCallback(async () => {
    try {
      setStatus(await usersApi.trackerStatus());
    } catch {
      /* transient — keep the last known state */
    }
  }, []);

  useEffect(() => {
    if (userId) dropForeignConnectTokens(userId);
    void refresh();
  }, [userId, refresh]);

  // onConnected: the first time a connection is observed (a live flip, or an
  // account that was already connected when this mounted).
  const firedRef = useRef(false);
  useEffect(() => {
    if (!connected || firedRef.current) return;
    firedRef.current = true;
    onConnected?.();
  }, [connected, onConnected]);

  // Track whether this mount saw the flip itself (for the celebration gate below).
  const sawFlipRef = useRef(false);
  const prevPhaseRef = useRef<Phase>("loading");
  useEffect(() => {
    if (prevPhaseRef.current === "waiting" && phase === "connected") sawFlipRef.current = true;
    prevPhaseRef.current = phase;
  }, [phase]);

  // Poll every 5s while waiting: the user is watching this card.
  useEffect(() => {
    if (phase !== "waiting") return;
    const id = window.setInterval(() => void refresh(), POLL_WAITING_MS);
    return () => window.clearInterval(id);
  }, [phase, refresh]);

  // Poll every 10s while connected and the panel is actually on screen (tab
  // visible, not dismissed). A dismissed Home banner relies on realtime alone.
  const panelVisible = connected && !(isBanner && seen);
  useEffect(() => {
    if (!panelVisible) return;
    let id: number | undefined;
    const stop = () => {
      if (id !== undefined) window.clearInterval(id);
      id = undefined;
    };
    const sync = () => {
      stop();
      if (document.visibilityState === "visible") id = window.setInterval(() => void refresh(), POLL_CONNECTED_MS);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [panelVisible, refresh]);

  // Realtime: the server pushes the viewer's own presence too. Merge it at once
  // (status word / activity), then pull the full status for sources and devices.
  const me = user ? presences.get(user.username) : undefined;
  useEffect(() => {
    if (!me) return;
    setStatus((prev) =>
      prev
        ? { ...prev, connected: me.status !== "offline", presence: { status: me.status, activity: me.activity } }
        : prev
    );
    void refresh();
  }, [me, refresh]);

  // Success modal — once per session, on the flip (or on first landing while
  // the explainer hasn't been seen yet).
  useEffect(() => {
    if (!connected) return;
    if (!sawFlipRef.current && userId && hasSeenTracking(userId)) return;
    try {
      if (sessionStorage.getItem(CELEBRATED_KEY)) return;
      sessionStorage.setItem(CELEBRATED_KEY, "1");
    } catch {
      /* private mode — still celebrate this once */
    }
    setCelebrating(true);
  }, [connected, userId]);

  // Token minted once: reuse the stored one when the server still lists it as
  // never used, otherwise mint (revoking the user's other never-used tokens).
  // ensureConnectToken dedupes in-flight calls, so StrictMode's double effect
  // and a Home → Settings hop share one mint.
  useEffect(() => {
    if (!userId || phase !== "waiting" || connectToken) return;
    let cancelled = false;
    ensureConnectToken(userId, deviceLabel(detectOs()))
      .then((t) => {
        if (!cancelled) setConnectToken(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not create a token");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, phase, connectToken]);

  // Once the tracker has used the stored token, forget it — the next connect
  // card (if ever) starts from a fresh one instead of a token already in use.
  useEffect(() => {
    if (!userId || !status) return;
    const stored = readStoredConnectToken(userId);
    if (!stored) return;
    const device = status.devices.find((d) => d.id === stored.tokenId);
    if (device?.lastUsedAt) clearStoredConnectToken(userId);
  }, [userId, status]);

  useEffect(() => {
    if (connected) {
      setConnectToken(null);
      setManual(false);
    }
  }, [connected]);

  const prompt = useMemo(
    () => (connectToken ? buildConnectPrompt(target, connectToken.token, API_BASE, WEB_URL) : null),
    [connectToken, target]
  );

  const copy = async (what: Copyable, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError("Copy failed — select the text and copy it manually.");
    }
  };

  const revoke = async (id: string) => {
    setError(null);
    try {
      await usersApi.revokeTrackerToken(id);
      if (userId && readStoredConnectToken(userId)?.tokenId === id) {
        clearStoredConnectToken(userId);
        setConnectToken(null);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke that device");
    }
  };

  // "Add another device" — a genuinely new token; never replaces anything.
  const addDevice = async () => {
    setAddingDevice(true);
    setError(null);
    try {
      const res = await usersApi.createTrackerToken(deviceLabel(os));
      setDeviceToken(res.token);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a token");
    } finally {
      setAddingDevice(false);
    }
  };

  const dismiss = () => {
    if (userId) markTrackingSeen(userId);
    setSeen(true);
  };

  // Exit transitions: the card leaves first, then the panel reveals in its place.
  const showCard = phase === "waiting";
  const { render: renderCard, closing: cardClosing } = useExitTransition(showCard, EXIT_MS);
  const showPanel = connected && !(isBanner && seen) && !renderCard;
  const { render: renderPanel, closing: panelClosing } = useExitTransition(showPanel, EXIT_MS);

  const now = useNow(variant === "full" && phase === "waiting", 5000);

  const celebrateBody =
    status?.presence.status === "active" && status.presence.activity
      ? presenceLine(status.presence.activity)
      : me?.status === "active" && me.activity
        ? presenceLine(me.activity)
        : "Waiting for the first heartbeat.";

  const modal = <ConnectSuccessModal open={celebrating} body={celebrateBody} onClose={() => setCelebrating(false)} />;

  if (phase === "loading") {
    if (isBanner && seen) return modal;
    return (
      <>
        <TrackingStatus
          variant={variant === "full" ? "settings" : "home"}
          status={null}
          className={cx(isBanner && styles.bannerSpacing)}
        />
        {modal}
      </>
    );
  }

  const targetLabel = TARGETS.find((t) => t.id === target)?.label ?? "your tool";

  return (
    <>
      {renderCard && (
        <Card
          className={cx(styles.card, isBanner && styles.bannerSpacing, cardClosing ? "leave" : "reveal")}
          aria-busy={!connectToken}
        >
          <div className={styles.head}>
            <span className={cx(styles.dot, cardClosing && styles.dotLive)} aria-hidden="true" />
            <div className={styles.headText}>
              <strong className={styles.title}>Connect your tools</strong>
              <span className={styles.sub}>Paste one prompt into your AI tool. No terminal needed.</span>
            </div>
          </div>

          <Segment label="AI tool" options={TARGETS} value={target} onChange={setTarget} />

          <div className={styles.promptBlock}>
            <div className={styles.promptHead}>
              <span className={styles.promptLabel}>Paste into {targetLabel}</span>
              <Button size="sm" onClick={() => prompt && copy("prompt", prompt)} disabled={!prompt}>
                <Icon name={copied === "prompt" ? "check" : "copy"} size={13} />
                {copied === "prompt" ? "Copied" : "Copy"}
              </Button>
            </div>
            {prompt ? (
              <pre className={styles.prompt}>{prompt}</pre>
            ) : (
              <Skeleton variant="block" height={168} width="100%" />
            )}
          </div>

          <div className={styles.foot}>
            <span className={cx(styles.waiting, !prompt && styles.waitingMuted)}>
              <span className={styles.pulse} aria-hidden="true" /> Listening…
            </span>
            <button
              type="button"
              className={styles.link}
              aria-expanded={manual}
              disabled={!connectToken}
              onClick={() => setManual((v) => !v)}
            >
              {manual ? "Hide manual setup" : "Do it manually"}
            </button>
          </div>

          {manual && connectToken && (
            <ManualInstall token={connectToken.token} os={os} onOs={setOs} copied={copied} onCopy={copy} />
          )}

          {variant === "full" && status && (
            <>
              <p className={styles.privacy}>
                Works with Claude Code, Codex CLI, Cursor, VS Code and Quadcode. Leaves your machine: tool, model,
                project name, timestamps, token counts. Never code, prompts or diffs.
              </p>
              <div className={styles.devices}>
                <span className={styles.label}>Devices</span>
                <DeviceList devices={status.devices} now={now} onRevoke={revoke} />
              </div>
            </>
          )}

          {error && <p className={styles.error}>{error}</p>}
        </Card>
      )}

      {renderPanel && status && (
        <TrackingStatus
          variant={variant === "full" ? "settings" : "home"}
          status={status}
          className={cx(isBanner && styles.bannerSpacing, panelClosing ? "leave" : "reveal")}
          onDismiss={isBanner ? dismiss : undefined}
          settingsHref={isBanner ? "/settings#tracker" : undefined}
          onRevoke={revoke}
          onAddDevice={variant === "full" ? addDevice : undefined}
          addingDevice={addingDevice}
          addDeviceBlock={
            deviceToken ? (
              <ManualInstall token={deviceToken} os={os} onOs={setOs} copied={copied} onCopy={copy} />
            ) : undefined
          }
          error={error}
        />
      )}

      {modal}
    </>
  );
}
