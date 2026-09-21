import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { API_BASE } from "../../lib/api";
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
} from "../../lib/connectPrompt";
import type { InstallOs } from "../../lib/connectPrompt";
import { claimConnectCelebration, deviceLabel, detectOs, ensureConnectToken } from "../../lib/connectToken";
import type { StoredConnectToken } from "../../lib/connectToken";
import { detectInstallChoice, scriptOs } from "../../lib/macInstall";
import type { InstallChoice } from "../../lib/macInstall";
import { useExitTransition } from "../../lib/motion";
import { formatElapsed, useTrackerPing } from "../../lib/useTrackerPing";
import { installedNote, shouldCelebrate, staleSinceWaiting, staleTrackerHint } from "../../lib/trackerPing";
import type { StaleTrackerHintCopy } from "../../lib/trackerPing";
import { toolLabel } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";
import { agoShort } from "../TrackingStatus";
import type { TrackerStatus } from "../../types";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import { ConnectCelebration } from "../ui/ConnectCelebration";
import { MacInstall } from "../MacInstall";
import { HookTools } from "./HookTools";
import styles from "./ConnectSheet.module.css";

const WEB_URL = window.location.origin;
const EXIT_MS = 200;
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
// Three install surfaces, one chooser. "macOS app" is the native VibeHub.app lane (its
// own panel, its own disclosures); the other two are the unchanged shell-script flows —
// same ids, same commands, same copy as before.
const OSES: { id: InstallChoice; label: string }[] = [
  { id: "mac-app", label: "macOS app" },
  { id: "mac", label: "macOS / Linux" },
  { id: "windows", label: "Windows" },
];

type AttemptCopy = "connect" | "assistant" | "start";
type Copied = AttemptCopy | "status" | "stop";
const firstStep = (copied: AttemptCopy | null) => copied === "connect"
  ? "Install & start command copied"
  : copied === "assistant" ? "Assistant prompt copied"
  : copied === "start" ? "Start command copied" : "Copy or select the command above";

// These are buttons choosing a command format, not provider tabs or incomplete tabs.
function OsPicker({ value, onChange }: { value: InstallChoice; onChange: (os: InstallChoice) => void }) {
  return (
    <div className={styles.seg} role="group" aria-label="Operating system">
      {OSES.map((os) => (
        <button
          key={os.id}
          type="button"
          aria-pressed={value === os.id}
          className={cx(styles.segBtn, value === os.id && styles.segBtnOn)}
          onClick={() => onChange(os.id)}
        >
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
 * Extracted from the sheet body so the disclosure travels with the command it explains:
 * wherever a script command renders, this renders above it, unconditionally. Its
 * disclosure state is local, which is also how it resets — the sheet unmounts on close.
 */
function ScriptConsent({ os }: { os: InstallOs }) {
  const id = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <>
      <p className={styles.explain}>{os === "windows" ? "Paste in PowerShell." : "Paste in Terminal."} {NODE_SETUP_NOTICE}</p>

      {/* Load-bearing consent is visible before the command and Copy. */}
      <div className={styles.consent} aria-label="Before you start">
        <p>{INSTALL_START_MEANS} {BACKGROUND_START_MEANS}</p>
        <p>{TRACKER_LOCAL_READS}</p>
        <p>{TRACKER_UPLOADS} {TRACKER_VISIBILITY}</p>
      </div>
      <button type="button" className={styles.helpToggle} aria-expanded={detailsOpen} aria-controls={`${id}-data`} onClick={() => setDetailsOpen((v) => !v)}>
        Data access and supported sources
      </button>
      {detailsOpen && (
        <div id={`${id}-data`} className={styles.stepDetails}>
          <p className={styles.explain}>{TRACKER_SUPPORT_NOTICE} {TRACKER_SUPPORT_DETAILS}</p>
          <p className={styles.explain}>{TRACKER_STATE_NOTICE} A needed Node.js runtime stays in VibeHub's folder. System PATH and OS startup settings stay unchanged.</p>
          <p className={styles.explain}>{TRACKER_CONTROL_NOTICE} {TRACKER_HISTORY_NOTICE}</p>
        </div>
      )}
      <p className={styles.note}>{PRIVATE_COMMAND_NOTICE}</p>
      <p className={styles.explain}>{COPY_ONLY_NOTICE}</p>
    </>
  );
}

function Progress({ stage, elapsedMs, stalled, device, tool, copied, anchor, stale }: {
  stage: "waiting" | "pinged" | "live";
  elapsedMs: number;
  stalled: boolean;
  device: string | null;
  tool: string | null;
  copied: AttemptCopy | null;
  anchor: RefObject<HTMLDivElement>;
  stale: StaleTrackerHintCopy | null;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  // A failed clipboard operation never earns a checkmark. The remaining two rows
  // require a server observation; neither a key nor a copied command counts.
  const rows = [
    { label: firstStep(copied), done: copied !== null, active: false },
    { label: stage === "waiting" ? stale?.lead ?? "Waiting for a tracker connection…" : "Server accepted connection", done: stage !== "waiting", active: stage === "waiting" },
    { label: "Tracker connected", done: stage === "live", active: stage === "pinged" },
  ];
  return (
    <div className={styles.step} ref={anchor}>
      <h3 className={styles.stepTitle}>Connection status</h3>
      <ol className={styles.progress}>
        {rows.map((row, i) => (
          <li key={i} className={cx(styles.pstep, row.done && styles.pstepDone, row.active && styles.pstepActive)}>
            <span className={styles.pmark} aria-hidden="true">
              {row.done ? <Icon name="check" size={12} /> : <span className={styles.pdot} />}
            </span>
            <span className={styles.plabel}>
              {row.label}
              {i === 1 && (stage === "waiting" ? (
                <span className={styles.elapsed} aria-label={`${formatElapsed(elapsedMs)} elapsed`}>{formatElapsed(elapsedMs)}</span>
              ) : device && (
                <span className={styles.stepMeta}>{[device, tool && toolLabel(tool)].filter(Boolean).join(" · ")}</span>
              ))}
            </span>
            {row.active && <span className={styles.pline} aria-hidden="true" />}
          </li>
        ))}
      </ol>
      {stage === "waiting" && stale && <p className={styles.staleFix}>{stale.fix}</p>}
      {stalled && (
        <div className={styles.help}>
          <button type="button" className={styles.helpToggle} aria-expanded={helpOpen} aria-controls={helpId} onClick={() => setHelpOpen((v) => !v)}>
            Still waiting? Common fixes
          </button>
          {helpOpen && (
            <ul id={helpId} className={cx(styles.helpList, "fade-in")}>
              <li>Copying does not run setup. Paste the install & start command in your terminal.</li>
              <li>Your assistant may be waiting for your yes or may have declined. A refusal is not a connection.</li>
              <li>Check the terminal for download, device-key or start errors. Keep it open until setup finishes.</li>
              <li>Already installed? Use Start / reconnect under Status, Stop & reconnect.</li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** A copy attempt means begin watching; never that an installer ran. */
  onStarted?: () => void;
  onCelebrated?: () => void;
}

/** One OS-matched device command. Bottom sheet on phones, existing modal on desktop.
 * The sheet owns copy/minting; the unchanged heartbeat hook owns connection evidence. */
export function ConnectSheet(props: Props) {
  const { user } = useAuth();
  return <ConnectSheetForUser key={user?.id ?? "signed-out"} {...props} />;
}

function ConnectSheetForUser({ open, onClose, onStarted, onCelebrated }: Props) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const id = useId();
  // `detectOs` stays the only Windows authority; `detectInstallChoice` adds the macOS
  // vs Linux split it cannot make, so only a real Mac lands on the app tab.
  const [choice, setChoice] = useState<InstallChoice>(() => detectInstallChoice(detectOs()));
  const os = scriptOs(choice);
  const [minted, setMinted] = useState<{ userId: string; token: StoredConnectToken } | null>(null);
  // Render-time ownership prevents a previous account's key appearing for one frame.
  const token = minted?.userId === userId ? minted.token : null;
  const [mintError, setMintError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [copied, setCopied] = useState<Copied | null>(null);
  const [attemptCopy, setAttemptCopy] = useState<AttemptCopy | null>(null);
  const [error, setError] = useState<{ what: Copied; message: string } | null>(null);
  const [celebrationState, setCelebrationState] = useState<{ userId: string; status: TrackerStatus | null } | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [started, setStarted] = useState(false);

  const { render, closing } = useExitTransition(open, EXIT_MS);
  const ping = useTrackerPing(open, started);
  // An account already live at open is informational, not a new completed attempt.
  const showProgress = !ping.liveAtOpen && ping.stage !== "idle";
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const progress = useRef<HTMLDivElement>(null);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setCopied(null);
    setAttemptCopy(null);
    setError(null);
  }, [choice, userId, open]);
  useEffect(() => () => { generation.current += 1; }, []);

  useEffect(() => {
    if (!open) return;
    setStarted(false);
    setMintError(null);
    setNoteOpen(false);
    setAssistantOpen(false);
    setControlsOpen(false);
  }, [open, userId]);

  // Keep per-user token deduplication and cancel old opens, users and retry attempts.
  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    setMinted(null);
    setMintError(null);
    ensureConnectToken(userId, deviceLabel(detectOs()))
      .then((next) => { if (!cancelled) setMinted({ userId, token: next }); })
      .catch(() => { if (!cancelled) setMintError("Could not prepare your private command."); });
    return () => { cancelled = true; };
  }, [open, userId, retry]);

  const commands = useMemo(() => {
    if (!token) return null;
    try {
      return {
        command: buildOneCommandConnect(os, token.token, API_BASE, WEB_URL),
        prompt: buildConnectPrompt("assistant", token.token, API_BASE, WEB_URL, os),
        error: null,
      };
    } catch {
      return { command: null, prompt: null, error: CONNECT_COMMAND_ERROR };
    }
  }, [token, os]);
  const startCmd = buildStartCommand(os);
  const statusCmd = buildStatusCommand(os);
  const stopCmd = buildStopCommand(os);

  const copy = async (what: Copied, value: string) => {
    const mine = ++generation.current;
    const stale = () => generation.current !== mine;
    const isAttempt = what === "connect" || what === "assistant" || what === "start";
    if (isAttempt) {
      setStarted(true);
      setAttemptCopy(null);
      onStarted?.();
    }
    setCopied(null);
    setError(null);
    try {
      await navigator.clipboard.writeText(value);
      if (stale()) return;
      setCopied(what);
      if (isAttempt) setAttemptCopy(what);
    } catch {
      if (stale()) return;
      setError({ what, message: "Copy failed — select and copy the text above." });
    }
  };

  // The existing fresh-heartbeat and per-user once gates remain authoritative.
  useEffect(() => {
    if (!open || !userId || !shouldCelebrate(ping.stage, ping.liveAtOpen)) return;
    if (claimConnectCelebration(userId)) setCelebrationState({ userId, status: ping.status });
    onClose();
  }, [open, ping.stage, ping.liveAtOpen, ping.status, userId, onClose]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      // Do not steal focus from the celebration's Enter button.
      const active = document.activeElement;
      if (!active || active === document.body || dialog.current?.contains(active)) opener.current?.focus();
    };
  }, [open]);

  // Successful copy may reveal progress. On clipboard denial keep the command and
  // inline recovery in view instead of scrolling away from the text to select.
  const progressScrolled = useRef(false);
  useEffect(() => { progressScrolled.current = false; }, [open, userId]);
  useEffect(() => {
    if (!open || !showProgress || !attemptCopy || progressScrolled.current) return;
    progressScrolled.current = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        progress.current?.scrollIntoView({ block: "end", behavior: reduced ? "auto" : "smooth" });
      });
    });
    return () => { window.cancelAnimationFrame(first); window.cancelAnimationFrame(second); };
  }, [open, showProgress, attemptCopy]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) { event.preventDefault(); dialog.current?.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const insideControl = active instanceof HTMLElement && active !== dialog.current && dialog.current?.contains(active);
    if (!insideControl) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, [onClose]);

  const celebrating = celebrationState?.userId === userId && celebrationState !== null;
  const celebration = (
    <ConnectCelebration
      open={celebrating}
      status={celebrating ? celebrationState.status : null}
      onRefresh={async () => {}}
      onClose={() => { setCelebrationState(null); onCelebrated?.(); }}
    />
  );
  if (!render) return celebration;

  const installed = installedNote(ping.status, agoShort);
  const staleHint = staleTrackerHint(ping.status);
  const staleNow = staleSinceWaiting(staleHint, ping.waitingSince);
  const setupError = mintError ?? commands?.error;
  const copyError = (what: Copied) => error?.what === what
    ? <p className={styles.error} role="alert">{error.message}</p> : null;

  return createPortal(
    <>
      <div className={cx(styles.scrim, closing && styles.scrimOut)} onClick={onClose} aria-hidden="true" />
      <div className={styles.wrap}>
        <div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="connect-sheet-title"
          tabIndex={-1}
          className={cx(styles.sheet, closing ? styles.sheetOut : styles.sheetIn)}
          onKeyDown={onKeyDown}
        >
          <header className={styles.head}>
            <h2 id="connect-sheet-title" className={styles.title}>Connect VibeHub</h2>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
              <Icon name="x" size={16} />
            </button>
          </header>
          <div className={styles.body}>
            <p className={styles.scope}>{DEVICE_CONNECT_SCOPE}</p>
            {installed && (
              <div className={styles.installed}>
                <p className={styles.installedLead}>{installed.lead}</p>
                {installed.detail && (
                  <>
                    <button type="button" className={styles.helpToggle} aria-expanded={noteOpen} aria-controls={`${id}-installed`} onClick={() => setNoteOpen((v) => !v)}>
                      Already installed?
                    </button>
                    {noteOpen && <p id={`${id}-installed`} className={styles.installedDetail}>{installed.detail}</p>}
                  </>
                )}
              </div>
            )}

            <div className={styles.step}>
              <h3 className={styles.stepTitle}>
                {choice === "mac-app" ? "Install VibeHub for Mac" : "Install and start VibeHub"}
              </h3>
              <OsPicker value={choice} onChange={setChoice} />
              {/* No `token` here on purpose: the sheet's key comes from
                  `ensureConnectToken`, which caches it in localStorage. FC4 keeps that
                  entry with the Windows/Linux flow, so the Mac panel issues its own. */}
              {choice === "mac-app" ? <MacInstall /> : (
                <>
              <ScriptConsent os={os} />
              {commands?.command ? (
                <>
                  <pre className={styles.text} tabIndex={0} aria-label="Install and start command">{commands.command}</pre>
                  <Button className={styles.copy} onClick={() => void copy("connect", commands.command!)}>
                    <Icon name={copied === "connect" ? "check" : "copy"} size={14} />
                    {copied === "connect" ? "Command copied" : "Copy install & start"}
                  </Button>
                </>
              ) : setupError ? (
                <div className={styles.stepDetails}>
                  <p className={styles.error} role="alert">{setupError}</p>
                  <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>Retry</Button>
                </div>
              ) : (
                <div className={styles.stepDetails} aria-busy="true" aria-label="Preparing your private command">
                  <Skeleton variant="block" height={96} width="100%" />
                  <Skeleton variant="pill" height={44} width="100%" />
                </div>
              )}
              {copyError("connect")}
                </>
              )}
            </div>

            {/* CLI-only helpers: an assistant prompt that carries the device key, and
                the tracker's own start/status/stop verbs. Neither applies to the app,
                which is driven from its menu bar, so the app tab hides both. */}
            {choice !== "mac-app" && (<>
            <div className={styles.help}>
              <button type="button" className={styles.helpToggle} aria-expanded={assistantOpen} aria-controls={`${id}-assistant`} onClick={() => setAssistantOpen((value) => !value)}>
                Ask your AI assistant
              </button>
              {assistantOpen && (
                <div id={`${id}-assistant`} className={styles.stepDetails}>
                  <p className={styles.explain}>This only changes where you run setup, not what gets tracked. A local coding assistant must ask for your yes before starting. ChatGPT can guide you but cannot run commands on your device.</p>
                  <p className={styles.explain}>If an assistant declines, stop automation. You may choose to use the terminal command above yourself; do not change its permissions to force a start.</p>
                  {commands?.prompt && (
                    <>
                      <pre className={styles.text} tabIndex={0} aria-label="Assistant setup prompt">{commands.prompt}</pre>
                      <Button variant="secondary" className={styles.copy} onClick={() => void copy("assistant", commands.prompt!)}>
                        {copied === "assistant" ? "Prompt copied" : "Copy assistant prompt"}
                      </Button>
                    </>
                  )}
                  {copyError("assistant")}
                </div>
              )}
            </div>

            <div className={styles.help}>
              <button type="button" className={styles.helpToggle} aria-expanded={controlsOpen} aria-controls={`${id}-controls`} onClick={() => setControlsOpen((value) => !value)}>
                Status, Stop & reconnect
              </button>
              {controlsOpen && (
                <div id={`${id}-controls`} className={styles.stepDetails}>
                  <p className={styles.explain}>{TRACKER_CONTROL_NOTICE}</p>
                  <p className={styles.explain}>Already installed? Start / reconnect uses the saved key and replaces a running tracker. It has the same background data access described above.</p>
                  {([
                    ["status", "Check status", statusCmd],
                    ["stop", "Stop", stopCmd],
                    ["start", "Start / reconnect", startCmd],
                  ] as const).map(([what, label, command]) => (
                    <div key={what} className={styles.control}>
                      <h4 className={styles.stepTitle}>{label}</h4>
                      <pre className={styles.text} tabIndex={0} aria-label={`${label} command`}>{command}</pre>
                      <Button variant="secondary" className={styles.copy} onClick={() => void copy(what, command)}>
                        {copied === what ? "Command copied" : `Copy ${label.toLowerCase()}`}
                      </Button>
                      {copyError(what)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <HookTools />
            </>)}

            {showProgress && (
              <Progress
                stage={ping.stage as "waiting" | "pinged" | "live"}
                elapsedMs={ping.elapsedMs}
                stalled={ping.stalled}
                device={ping.device}
                tool={ping.tool}
                copied={attemptCopy}
                anchor={progress}
                stale={staleNow ? staleHint : null}
              />
            )}
          </div>
        </div>
      </div>
      {celebration}
    </>,
    document.body,
  );
}
