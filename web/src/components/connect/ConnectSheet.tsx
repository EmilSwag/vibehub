import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import {
  BACKGROUND_START_MEANS,
  CONNECT_COMMAND_ERROR,
  DEVICE_CONNECT_SCOPE,
  INSTALL_START_MEANS,
  NODE_SETUP_NOTICE,
  TRACKER_CONTROL_NOTICE,
  TRACKER_HISTORY_NOTICE,
  TRACKER_LOCAL_READS,
  TRACKER_STATE_NOTICE,
  TRACKER_SUPPORT_DETAILS,
  TRACKER_SUPPORT_NOTICE,
  TRACKER_UPLOADS,
  TRACKER_VISIBILITY,
  buildPairConnectCommand,
} from "../../lib/connectPrompt";
import { claimConnectCelebration, deviceLabel, detectOs, ensureConnectToken } from "../../lib/connectToken";
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
import { ConnectCelebration } from "../ui/ConnectCelebration";
import { MacInstall } from "../MacInstall";
import styles from "./ConnectSheet.module.css";

const EXIT_MS = 200;
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

const OSES: { id: InstallChoice; label: string }[] = [
  { id: "mac-app", label: "macOS app" },
  { id: "windows", label: "Windows" },
  { id: "mac", label: "macOS / Linux" },
];

type AttemptCopy = "connect" | "start";
type Copied = AttemptCopy;
const firstStep = (copied: AttemptCopy | null) =>
  copied === "connect" ? "Command copied" : "Copy or run the command above";

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

function Progress({
  stage,
  elapsedMs,
  stalled,
  device,
  tool,
  copied,
  anchor,
  stale,
}: {
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
  const rows = [
    { label: firstStep(copied), done: copied !== null, active: false },
    {
      label: stage === "waiting" ? stale?.lead ?? "Waiting for connection…" : "Server accepted connection",
      done: stage !== "waiting",
      active: stage === "waiting",
    },
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
              {i === 1 &&
                (stage === "waiting" ? (
                  <span className={styles.elapsed} aria-label={`${formatElapsed(elapsedMs)} elapsed`}>
                    {formatElapsed(elapsedMs)}
                  </span>
                ) : (
                  device && (
                    <span className={styles.stepMeta}>
                      {[device, tool && toolLabel(tool)].filter(Boolean).join(" · ")}
                    </span>
                  )
                ))}
            </span>
            {row.active && <span className={styles.pline} aria-hidden="true" />}
          </li>
        ))}
      </ol>
      {stage === "waiting" && stale && <p className={styles.staleFix}>{stale.fix}</p>}
      {stalled && (
        <div className={styles.help}>
          <button
            type="button"
            className={styles.helpToggle}
            aria-expanded={helpOpen}
            aria-controls={helpId}
            onClick={() => setHelpOpen((v) => !v)}
          >
            Still waiting? Common fixes
          </button>
          {helpOpen && (
            <ul id={helpId} className={cx(styles.helpList, "fade-in")}>
              <li>Copying does not run setup. Run the command in PowerShell or Terminal.</li>
              <li>A browser window will open to approve this device. Click &ldquo;Allow this device&rdquo;.</li>
              <li>Keep your terminal open until pairing completes.</li>
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
  onStarted?: () => void;
  onCelebrated?: () => void;
}

export function ConnectSheet(props: Props) {
  const { user } = useAuth();
  return <ConnectSheetForUser key={user?.id ?? "signed-out"} {...props} />;
}

function ConnectSheetForUser({ open, onClose, onStarted, onCelebrated }: Props) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const id = useId();
  const [choice, setChoice] = useState<InstallChoice>(() => detectInstallChoice(detectOs()));
  const os = scriptOs(choice);
  const [retry] = useState(0);
  const [copied, setCopied] = useState<Copied | null>(null);
  const [attemptCopy, setAttemptCopy] = useState<AttemptCopy | null>(null);
  const [error, setError] = useState<{ what: Copied; message: string } | null>(null);
  const [celebrationState, setCelebrationState] = useState<{ userId: string; status: TrackerStatus | null } | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [started, setStarted] = useState(false);

  const { render, closing } = useExitTransition(open, EXIT_MS);
  const ping = useTrackerPing(open, started);
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
    setNoteOpen(false);
    setDetailsOpen(false);
  }, [open, userId]);

  // Keep per-user token deduplication and cancel old opens, users and retry attempts.
  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    ensureConnectToken(userId, deviceLabel(detectOs()))
      .then(() => { if (!cancelled) { /* token cached */ } })
      .catch(() => { if (!cancelled) { /* ignore */ } });
    return () => { cancelled = true; };
  }, [open, userId, retry]);

  const command = useMemo(() => {
    try {
      return buildPairConnectCommand(os);
    } catch {
      return null;
    }
  }, [os]);

  const copy = async (what: Copied, value: string) => {
    const mine = ++generation.current;
    const stale = () => generation.current !== mine;
    setStarted(true);
    setAttemptCopy(null);
    onStarted?.();
    setCopied(null);
    setError(null);
    try {
      await navigator.clipboard.writeText(value);
      if (stale()) return;
      setCopied(what);
      setAttemptCopy(what);
    } catch {
      if (stale()) return;
      setError({ what, message: "Copy failed — select and copy the text above." });
    }
  };

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
      const active = document.activeElement;
      if (!active || active === document.body || dialog.current?.contains(active)) opener.current?.focus();
    };
  }, [open]);

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
  const copyError = (what: Copied) =>
    error?.what === what ? <p className={styles.error} role="alert">{error.message}</p> : null;

  // The Mac panel opens with its own one-liner, so the sheet stays quiet on that tab.
  const honestLine = choice === "mac-app" ? null : "One command. Approve in your browser, no tokens.";

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
            {honestLine && <p className={styles.scope}>{honestLine}</p>}

            {installed && (
              <div className={styles.installed}>
                <p className={styles.installedLead}>{installed.lead}</p>
                {installed.detail && (
                  <>
                    <button
                      type="button"
                      className={styles.helpToggle}
                      aria-expanded={noteOpen}
                      aria-controls={`${id}-installed`}
                      onClick={() => setNoteOpen((v) => !v)}
                    >
                      Already installed?
                    </button>
                    {noteOpen && <p id={`${id}-installed`} className={styles.installedDetail}>{installed.detail}</p>}
                  </>
                )}
              </div>
            )}

            <div className={styles.step}>
              <OsPicker value={choice} onChange={setChoice} />

              {choice === "mac-app" ? (
                <MacInstall />
              ) : (
                <>
                  {command ? (
                    <div className={styles.step}>
                      <pre className={styles.text} tabIndex={0} aria-label="Install and start command">
                        {command}
                      </pre>
                      <Button className={styles.copy} onClick={() => void copy("connect", command)}>
                        <Icon name={copied === "connect" ? "check" : "copy"} size={14} />
                        {copied === "connect" ? "Command copied" : "Copy install command"}
                      </Button>
                      {copyError("connect")}
                    </div>
                  ) : (
                    <p className={styles.error} role="alert">{CONNECT_COMMAND_ERROR}</p>
                  )}
                </>
              )}
            </div>

            {/* Accessible Details disclosure. The Mac tab carries its own ("What it reads
                and sends"), so the sheet's would be a second toggle for the same facts. */}
            {choice !== "mac-app" && <div className={styles.help}>
              <button
                type="button"
                className={styles.helpToggle}
                aria-expanded={detailsOpen}
                aria-controls={`${id}-data`}
                onClick={() => setDetailsOpen((v) => !v)}
              >
                Details {detailsOpen ? "▴" : "▾"}
              </button>
              {detailsOpen && (
                <div id={`${id}-data`} className={styles.stepDetails}>
                  <p className={styles.explain}>{DEVICE_CONNECT_SCOPE}</p>
                  <p className={styles.explain}>{NODE_SETUP_NOTICE}</p>
                  <p className={styles.explain}>{INSTALL_START_MEANS} {BACKGROUND_START_MEANS}</p>
                  <p className={styles.explain}>{TRACKER_LOCAL_READS}</p>
                  <p className={styles.explain}>{TRACKER_UPLOADS} {TRACKER_VISIBILITY}</p>
                  <p className={styles.explain}>{TRACKER_SUPPORT_NOTICE} {TRACKER_SUPPORT_DETAILS}</p>
                  <p className={styles.explain}>{TRACKER_STATE_NOTICE}</p>
                  <p className={styles.explain}>{TRACKER_CONTROL_NOTICE} {TRACKER_HISTORY_NOTICE}</p>
                </div>
              )}
            </div>}

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
