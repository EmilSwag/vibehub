import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { API_BASE, usersApi } from "../lib/api";
import {
  BACKGROUND_START_MEANS,
  CONNECT_COMMAND_ERROR,
  COPY_ONLY_NOTICE,
  DEVICE_CONNECT_SCOPE,
  INSTALL_START_MEANS,
  NODE_SETUP_NOTICE,
  PRIVATE_COMMAND_NOTICE,
  TRACKER_CONTROL_NOTICE,
  TRACKER_HISTORY_NOTICE,
  TRACKER_LOCAL_READS,
  TRACKER_STATE_NOTICE,
  TRACKER_SUPPORT_DETAILS,
  TRACKER_SUPPORT_NOTICE,
  TRACKER_UPLOADS,
  TRACKER_VISIBILITY,
  buildConnectPrompt,
  buildOneCommandConnect,
  buildStartCommand,
  buildStatusCommand,
  buildStopCommand,
} from "../lib/connectPrompt";
import type { InstallOs } from "../lib/connectPrompt";
import {
  claimConnectCelebration,
  clearStoredConnectToken,
  deviceLabel,
  detectOs,
  dropForeignConnectTokens,
  hasSeenTracking,
  markTrackingSeen,
  readStoredConnectToken,
} from "../lib/connectToken";
import { detectInstallChoice, scriptOs } from "../lib/macInstall";
import type { InstallChoice } from "../lib/macInstall";
import { connectionAlive, newer, observePing } from "../lib/trackerPing";
import type { PingObservation } from "../lib/trackerPing";
import { useExitTransition } from "../lib/motion";
import type { TrackerStatus } from "../types";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { ConnectCelebration } from "./ui/ConnectCelebration";
import { ConnectSheet } from "./connect/ConnectSheet";
import { MacInstall } from "./MacInstall";
import { DeviceList, TrackingStatus, TrackingStrip } from "./TrackingStatus";
import { useNow } from "./ui/PresenceBlock";
import styles from "./ConnectTools.module.css";

const WEB_URL = window.location.origin;
const POLL_WAITING_MS = 5_000;
const POLL_CONNECTED_MS = 10_000;
const EXIT_MS = 260;
// Three install surfaces, one chooser. "macOS app" is the native VibeHub.app lane (its
// own panel, its own disclosures); the other two are the unchanged shell-script flows —
// same ids, same commands, same copy as before.
const OSES: { id: InstallChoice; label: string }[] = [
  { id: "mac-app", label: "macOS app" },
  { id: "mac", label: "macOS / Linux" },
  { id: "windows", label: "Windows" },
];
type Copyable = "command" | "assistant" | "start" | "status" | "stop";
type CopyError = { what: Copyable; message: string } | null;
type Phase = "loading" | "waiting" | "connected" | "offline";
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

function OsPicker({ value, onChange }: { value: InstallChoice; onChange: (os: InstallChoice) => void }) {
  return (
    <div className={styles.seg} role="group" aria-label="Operating system">
      {OSES.map((os) => (
        <button key={os.id} type="button" aria-pressed={value === os.id}
          className={cx(styles.segBtn, value === os.id && styles.segBtnOn)} onClick={() => onChange(os.id)}>
          {os.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Everything the shell-script tabs must say before their command — and nothing the
 * macOS app tab may borrow.
 *
 * `INSTALL_START_MEANS`, `BACKGROUND_START_MEANS` and `PRIVATE_COMMAND_NOTICE` describe
 * the connector exactly: it installs *and* starts tracking, never touches OS autostart,
 * and carries a device key. All three are false of VibeHub.app, which installs without
 * tracking anything, does resume at login once started, and is tokenless — so the app
 * tab renders `MacInstall`'s own disclosures instead of these.
 *
 * Extracted from ManualInstall so the disclosure travels with the command it explains:
 * wherever a script command renders, this renders above it, unconditionally.
 */
function ScriptConsent({ os }: { os: InstallOs }) {
  const id = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <>
      <p className={styles.sub}>{os === "windows" ? "Paste in PowerShell." : "Paste in Terminal."} {NODE_SETUP_NOTICE}</p>
      <div className={styles.consent} aria-label="Before you start">
        <p>{INSTALL_START_MEANS} {BACKGROUND_START_MEANS}</p>
        <p>{TRACKER_LOCAL_READS}</p>
        <p>{TRACKER_UPLOADS} {TRACKER_VISIBILITY}</p>
      </div>
      <button type="button" className={styles.link} aria-expanded={detailsOpen} aria-controls={`${id}-data`} onClick={() => setDetailsOpen((value) => !value)}>
        Data access and supported sources
      </button>
      {detailsOpen && (
        <div id={`${id}-data`} className={styles.details}>
          <p className={styles.sub}>{TRACKER_SUPPORT_NOTICE} {TRACKER_SUPPORT_DETAILS}</p>
          <p className={styles.sub}>{TRACKER_STATE_NOTICE} A needed Node.js runtime stays in VibeHub's folder. System PATH and OS startup settings stay unchanged.</p>
          <p className={styles.sub}>{TRACKER_CONTROL_NOTICE} {TRACKER_HISTORY_NOTICE}</p>
        </div>
      )}
      <p className={styles.sub}>{PRIVATE_COMMAND_NOTICE}</p>
      <p className={styles.sub}>{COPY_ONLY_NOTICE}</p>
    </>
  );
}

/** Settings uses the same command and foreground disclosure as the main sheet. */
function ManualInstall({ token, choice, onChoice, copied, onCopy, error }: {
  token: string;
  choice: InstallChoice;
  onChoice: (choice: InstallChoice) => void;
  copied: Copyable | null;
  onCopy: (what: Copyable, text: string) => void;
  error: CopyError;
}) {
  const id = useId();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  // The app tab has no script. It still resolves to a real InstallOs so the builders
  // below stay total; nothing built from it is rendered while that tab is open.
  const os = scriptOs(choice);
  const commands = useMemo(() => {
    try {
      return {
        command: buildOneCommandConnect(os, token, API_BASE, WEB_URL),
        prompt: buildConnectPrompt("assistant", token, API_BASE, WEB_URL, os),
        error: null,
      };
    } catch {
      return { command: null, prompt: null, error: CONNECT_COMMAND_ERROR };
    }
  }, [os, token]);
  const copyError = (what: Copyable) => error?.what === what
    ? <p className={styles.error} role="alert">{error.message}</p> : null;
  return (
    <div className={cx(styles.manual, "fade-in")}>
      <h3 className={styles.manualLabel}>
        {choice === "mac-app" ? "Install VibeHub on the Mac you're adding" : "Install and start on the device you're adding"}
      </h3>
      <p className={styles.sub}>{DEVICE_CONNECT_SCOPE}</p>
      <OsPicker value={choice} onChange={onChoice} />
      {/* Add device already minted this key on an explicit click and never cached it,
          so the Mac panel shows that one instead of issuing a second. */}
      {choice === "mac-app" ? <MacInstall token={token} /> : (
        <>
      <ScriptConsent os={os} />
      {commands.command ? (
        <div className={styles.cmdRow}>
          <pre className={styles.cmd} tabIndex={0} aria-label="Install and start command">{commands.command}</pre>
          <Button className={styles.cmdCopy} onClick={() => onCopy("command", commands.command!)}>
            {copied === "command" ? "Command copied" : "Copy install & start"}
          </Button>
        </div>
      ) : <p className={styles.error} role="alert">{commands.error}</p>}
      {copyError("command")}
      <button type="button" className={styles.link} aria-expanded={assistantOpen} aria-controls={`${id}-assistant`} onClick={() => setAssistantOpen((value) => !value)}>
        Ask your AI assistant
      </button>
      {assistantOpen && (
        <div id={`${id}-assistant`} className={styles.details}>
          <p className={styles.sub}>This changes where you run setup, not what gets tracked. A local coding assistant must ask for your yes before starting. ChatGPT can guide you but cannot run commands on your device.</p>
          <p className={styles.sub}>If an assistant declines, stop automation. You may choose to run the terminal command yourself; never change its permissions to force a start.</p>
          {commands.prompt && (
            <div className={styles.cmdRow}>
              <pre className={styles.cmd} tabIndex={0} aria-label="Assistant setup prompt">{commands.prompt}</pre>
              <Button variant="secondary" className={styles.cmdCopy} onClick={() => onCopy("assistant", commands.prompt!)}>
                {copied === "assistant" ? "Prompt copied" : "Copy assistant prompt"}
              </Button>
            </div>
          )}
          {copyError("assistant")}
        </div>
      )}
      <button type="button" className={styles.link} aria-expanded={controlsOpen} aria-controls={`${id}-controls`} onClick={() => setControlsOpen((value) => !value)}>
        Status, Stop & reconnect
      </button>
      {controlsOpen && (
        <div id={`${id}-controls`} className={styles.details}>
          <p className={styles.sub}>{TRACKER_CONTROL_NOTICE}</p>
          <p className={styles.sub}>Already installed? Start / reconnect uses the saved key and replaces a running tracker. It has the same background data access described above.</p>
          {([
            ["status", "Check status", buildStatusCommand(os)],
            ["stop", "Stop", buildStopCommand(os)],
            ["start", "Start / reconnect", buildStartCommand(os)],
          ] as const).map(([what, label, command]) => (
            <div key={what} className={styles.details}>
              <h4 className={styles.manualLabel}>{label}</h4>
              <div className={styles.cmdRow}>
                <pre className={styles.cmd} tabIndex={0} aria-label={`${label} command`}>{command}</pre>
                <Button variant="secondary" className={styles.cmdCopy} onClick={() => onCopy(what, command)}>
                  {copied === what ? "Command copied" : `Copy ${label.toLowerCase()}`}
                </Button>
              </div>
              {copyError(what)}
            </div>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}

interface Props {
  variant?: "compact" | "banner" | "full";
  /** First server-observed live connection, including one already live at mount. */
  onConnected?: () => void;
  onCelebrated?: () => void;
}

/** A user change remounts all visible and in-flight connection state together. */
export function ConnectTools(props: Props) {
  const { user } = useAuth();
  return <ConnectToolsForUser key={user?.id ?? "signed-out"} {...props} />;
}

function ConnectToolsForUser({ variant = "compact", onConnected, onCelebrated }: Props) {
  const { user } = useAuth();
  const { presences } = useRealtime();
  const userId = user?.id ?? null;
  const isBanner = variant === "banner";
  const [observation, setObservation] = useState<PingObservation<TrackerStatus> | null>(null);
  const status = observation?.tracker ?? null;
  const [deviceToken, setDeviceToken] = useState<{ token: string; tokenId: string; baselineAt: string | null } | null>(null);
  const [addingDevice, setAddingDevice] = useState(false);
  // `detectOs` stays the only Windows authority; `detectInstallChoice` adds the macOS
  // vs Linux split it cannot make, so only a real Mac lands on the app tab.
  const [choice, setChoice] = useState<InstallChoice>(() => detectInstallChoice(detectOs()));
  const os = scriptOs(choice);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copied, setCopied] = useState<Copyable | null>(null);
  const [copyError, setCopyError] = useState<CopyError>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [seen, setSeen] = useState(() => (userId ? hasSeenTracking(userId) : false));
  const mounted = useRef(false);
  const refreshGeneration = useRef(0);
  const copyGeneration = useRef(0);
  const actionGeneration = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      refreshGeneration.current += 1;
      copyGeneration.current += 1;
      actionGeneration.current += 1;
    };
  }, []);

  const hasHeartbeat = status !== null && newer(status.lastSeenAt, null);
  const phase: Phase = !status ? "loading" : hasHeartbeat && connectionAlive(status)
    ? "connected" : hasHeartbeat ? "offline" : "waiting";
  const connected = phase === "connected";
  const everConnected = connected || phase === "offline";

  const refresh = useCallback(async () => {
    if (!mounted.current || !userId) return;
    const mine = ++refreshGeneration.current;
    try {
      const next = await usersApi.trackerStatus();
      if (!mounted.current || mine !== refreshGeneration.current) return;
      setObservation((previous) => observePing(previous, next));
      setStatusError(null);
    } catch {
      if (mounted.current && mine === refreshGeneration.current) setStatusError("Could not check tracker status. Try again.");
    }
  }, [userId]);

  useEffect(() => {
    if (userId) dropForeignConnectTokens(userId);
    void refresh();
  }, [userId, refresh]);

  const firedRef = useRef(false);
  useEffect(() => {
    if (!connected || firedRef.current) return;
    firedRef.current = true;
    onConnected?.();
  }, [connected, onConnected]);

  useEffect(() => {
    if (phase !== "waiting") return;
    const id = window.setInterval(() => void refresh(), POLL_WAITING_MS);
    return () => window.clearInterval(id);
  }, [phase, refresh]);

  useEffect(() => {
    if (!everConnected) return;
    let id: number | undefined;
    const stop = () => { if (id !== undefined) window.clearInterval(id); id = undefined; };
    const sync = () => {
      stop();
      if (document.visibilityState === "visible") id = window.setInterval(() => void refresh(), POLL_CONNECTED_MS);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { stop(); document.removeEventListener("visibilitychange", sync); };
  }, [everConnected, refresh]);

  // Presence is a reason to fetch, not proof of a first heartbeat. Only the server
  // status response may advance the baseline or announce a connection.
  const me = user ? presences.get(user.username) : undefined;
  useEffect(() => { if (me) void refresh(); }, [me, refresh]);

  const celebrationAttempted = useRef(false);
  useEffect(() => {
    if (celebrationAttempted.current || !connected || !userId || !observation || observation.liveAtOpen) return;
    if (!status || !connectionAlive(status) || !newer(status.lastSeenAt, observation.baselineAt)) return;
    celebrationAttempted.current = true;
    if (claimConnectCelebration(userId)) setCelebrating(true);
  }, [connected, userId, observation, status]);

  const closeCelebration = useCallback(() => { setCelebrating(false); onCelebrated?.(); }, [onCelebrated]);

  useEffect(() => {
    if (!userId || !status) return;
    const stored = readStoredConnectToken(userId);
    if (!stored) return;
    if (status.devices.find((device) => device.id === stored.tokenId)?.lastUsedAt) clearStoredConnectToken(userId);
  }, [userId, status]);

  // Close on a witnessed transition, never on each poll of an already-live account.
  const previouslyConnected = useRef(false);
  useEffect(() => {
    const transitioned = connected && !previouslyConnected.current;
    previouslyConnected.current = connected;
    if (transitioned && observation && !observation.liveAtOpen && newer(status?.lastSeenAt ?? null, observation.baselineAt)) setSheetOpen(false);
  }, [connected, observation, status]);

  // A verified key alone must not hide the instructions. Keep the established fold,
  // but require a fresh accepted account heartbeat as well. The existing API does
  // not expose a per-device heartbeat; do not claim which machine sent that ping.
  useEffect(() => {
    if (!deviceToken || !status || !newer(status.lastSeenAt, deviceToken.baselineAt)) return;
    if (status.devices.find((device) => device.id === deviceToken.tokenId)?.lastUsedAt) setDeviceToken(null);
  }, [deviceToken, status]);

  useEffect(() => {
    copyGeneration.current += 1;
    setCopied(null);
    setCopyError(null);
  }, [choice, deviceToken?.tokenId]);

  const copy = async (what: Copyable, text: string) => {
    const mine = ++copyGeneration.current;
    setCopied(null);
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(text);
      if (!mounted.current || mine !== copyGeneration.current) return;
      setCopied(what);
    } catch {
      if (mounted.current && mine === copyGeneration.current) setCopyError({ what, message: "Copy failed — select and copy the text above." });
    }
  };

  const revoke = async (id: string) => {
    setError(null);
    try {
      await usersApi.revokeTrackerToken(id);
      if (!mounted.current) return;
      if (userId && readStoredConnectToken(userId)?.tokenId === id) clearStoredConnectToken(userId);
      if (deviceToken?.tokenId === id) setDeviceToken(null);
      await refresh();
    } catch {
      if (mounted.current) setError("Could not revoke that device. Try again.");
    }
  };

  const addDevice = async () => {
    if (!userId || addingDevice) return;
    const mine = ++actionGeneration.current;
    setAddingDevice(true);
    setError(null);
    try {
      const result = await usersApi.createTrackerToken(deviceLabel(os));
      if (!mounted.current || mine !== actionGeneration.current) return;
      setDeviceToken({ ...result, baselineAt: status?.lastSeenAt ?? null });
      await refresh();
    } catch {
      if (mounted.current && mine === actionGeneration.current) setError("Could not prepare a device command. Try Add device again.");
    } finally {
      if (mounted.current && mine === actionGeneration.current) setAddingDevice(false);
    }
  };

  const dismiss = () => { if (userId) markTrackingSeen(userId); setSeen(true); };
  const showCard = phase === "waiting";
  const { render: renderCard, closing: cardClosing } = useExitTransition(showCard, EXIT_MS);
  const showPanel = everConnected && !(isBanner && seen) && !renderCard;
  const { render: renderPanel, closing: panelClosing } = useExitTransition(showPanel, EXIT_MS);
  const showStrip = isBanner && everConnected && seen && !renderCard && !renderPanel;
  const now = useNow(variant === "full" && phase === "waiting", 5000);
  const celebration = <ConnectCelebration open={celebrating} status={status} onRefresh={refresh} onClose={closeCelebration} />;
  const statusRetry = statusError && (
    <div className={styles.details}>
      <p className={styles.error} role="alert">{statusError}</p>
      <Button variant="secondary" onClick={() => void refresh()}>Retry status check</Button>
    </div>
  );

  if (phase === "loading") {
    if (statusRetry) return <Card className={cx(styles.card, isBanner && styles.bannerSpacing)}>{statusRetry}</Card>;
    if (isBanner && seen) return celebration;
    return <><TrackingStatus variant={variant === "full" ? "settings" : "home"} status={null} className={cx(isBanner && styles.bannerSpacing)} />{celebration}</>;
  }

  return (
    <>
      {renderCard && (
        <Card className={cx(styles.card, isBanner && styles.bannerSpacing, cardClosing ? "leave" : "reveal")}>
          {variant !== "compact" && (
            <div className={styles.head}>
              <strong className={styles.title}>Connect VibeHub</strong>
              <span className={styles.sub}>{DEVICE_CONNECT_SCOPE}</span>
            </div>
          )}
          <Button className={styles.copy} onClick={() => setSheetOpen(true)}>Connect VibeHub</Button>
          {(attempted || variant === "compact") && (
            <div className={styles.foot}>
              <span className={styles.waiting} role="status">
                <span className={cx(styles.pulse, !attempted && styles.pulseStill)} aria-hidden="true" />
                {attempted ? "Waiting for a tracker connection…" : "Not connected"}
              </span>
            </div>
          )}
          {variant === "full" && status && (
            <>
              <p className={styles.privacy}>{TRACKER_LOCAL_READS} {TRACKER_UPLOADS} {TRACKER_VISIBILITY}</p>
              <div className={styles.devices}>
                <span className={styles.label}>Devices</span>
                <DeviceList devices={status.devices} now={now} onRevoke={revoke} />
              </div>
            </>
          )}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </Card>
      )}
      {renderPanel && status && (
        <TrackingStatus
          variant={variant === "full" ? "settings" : "home"}
          status={status}
          className={cx(isBanner && styles.bannerSpacing, panelClosing ? "leave" : "reveal")}
          onDismiss={isBanner ? dismiss : undefined}
          onGoOnline={() => setSheetOpen(true)}
          settingsHref={isBanner ? "/settings#tracker" : undefined}
          onRevoke={revoke}
          onAddDevice={variant === "full" ? addDevice : undefined}
          addingDevice={addingDevice}
          addDeviceBlock={deviceToken ? <ManualInstall key={deviceToken.tokenId} token={deviceToken.token} choice={choice} onChoice={setChoice} copied={copied} onCopy={copy} error={copyError} /> : undefined}
          error={error}
        />
      )}
      {showStrip && status && <TrackingStrip status={status} settingsHref="/settings#tracker" onGoOnline={() => setSheetOpen(true)} className={cx(styles.bannerSpacing, "reveal")} />}
      {statusRetry}
      <ConnectSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onStarted={() => setAttempted(true)} onCelebrated={onCelebrated} />
      {celebration}
    </>
  );
}
