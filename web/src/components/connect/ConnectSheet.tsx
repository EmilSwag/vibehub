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
import { claimConnectCelebration, detectOs } from "../../lib/connectToken";
import { detectInstallChoice, scriptOs } from "../../lib/macInstall";
import type { InstallChoice } from "../../lib/macInstall";
import { useExitTransition } from "../../lib/motion";
import { formatElapsed, useTrackerPing } from "../../lib/useTrackerPing";
import { installedNote, shouldCelebrate, staleSinceWaiting, staleTrackerHint } from "../../lib/trackerPing";
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

/** Where the account is being seen from right now: the device with the newest
 *  heartbeat, else the account's own last ping. Never a never-used token. */
function liveWhere(status: TrackerStatus | null, ago: (iso: string) => string): string | null {
  if (!status) return null;
  const newest = (key: "lastSeenAt" | "lastUsedAt") => status.devices
    .filter((d) => d[key])
    .sort((x, y) => ((x[key] ?? "") < (y[key] ?? "") ? 1 : -1))[0];
  // Heartbeat evidence first; an older server only dates devices by last use.
  const seen = status.devices.find((d) => d.connected) ?? newest("lastSeenAt") ?? newest("lastUsedAt");
  const at = seen?.lastSeenAt ?? status.lastSeenAt;
  return [seen?.label, at && `seen ${ago(at)}`].filter(Boolean).join(" · ") || null;
}

/** One live line — never a dead wait (ADHD rule 3). */
function LiveStatus({
  stage,
  elapsedMs,
  showElapsed,
  device,
  tool,
  anchor,
}: {
  stage: "idle" | "waiting" | "pinged" | "live";
  elapsedMs: number;
  showElapsed: boolean;
  device: string | null;
  tool: string | null;
  anchor: RefObject<HTMLDivElement>;
}) {
  const done = stage === "live";
  return (
    <div className={styles.step} ref={anchor} role="status" aria-live="polite">
      <p className={cx(styles.pstep, done ? styles.pstepDone : styles.pstepActive)}>
        <span className={styles.pmark} aria-hidden="true">
          {done ? <Icon name="check" size={12} /> : <span className={styles.pdot} />}
        </span>
        <span className={styles.plabel}>
          {done ? "Connected" : stage === "pinged" ? "Almost there…" : "Waiting for your device…"}
          {!done && showElapsed && (
            <span className={styles.elapsed} aria-label={`${formatElapsed(elapsedMs)} elapsed`}>
              {formatElapsed(elapsedMs)}
            </span>
          )}
          {done && device && (
            <span className={styles.stepMeta}>{[device, tool && toolLabel(tool)].filter(Boolean).join(" · ")}</span>
          )}
        </span>
      </p>
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
  const [copied, setCopied] = useState<Copied | null>(null);
  const [attemptCopy, setAttemptCopy] = useState<AttemptCopy | null>(null);
  const [error, setError] = useState<{ what: Copied; message: string } | null>(null);
  const [celebrationState, setCelebrationState] = useState<{ userId: string; status: TrackerStatus | null } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [started, setStarted] = useState(false);

  const { render, closing } = useExitTransition(open, EXIT_MS);
  const ping = useTrackerPing(open, started);
  // Already live on open → a success screen, not a setup (QA R4). Setup is one tap away.
  const showSuccess = ping.liveAtOpen && !addOpen;
  const showProgress = !showSuccess && !ping.liveAtOpen;
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
    setAddOpen(false);
    setDetailsOpen(false);
  }, [open, userId]);

  // No token is minted on open (QA R4): the pairing command below is tokenless and the
  // Mac app pairs in the browser, so an open that mints only piles up "never used"
  // devices. Tokens are minted lazily, by an explicit Add device / Create key action.

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
  const where = showSuccess ? liveWhere(ping.status, agoShort) : null;
  const pasteIn = choice === "windows" ? "Paste in PowerShell. Approve in your browser." : "Paste in Terminal. Approve in your browser.";

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
            <h2 id="connect-sheet-title" className={styles.title}>
              {showSuccess ? "You're connected" : addOpen ? "Add a device" : "Connect VibeHub"}
            </h2>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
              <Icon name="x" size={16} />
            </button>
          </header>
          <div className={styles.body}>
            {showSuccess ? (
              <div className={cx(styles.success, "fade-in")}>
                <span className={styles.successMark} aria-hidden="true"><Icon name="check" size={20} /></span>
                {where && <p className={styles.scope}>{where}</p>}
                <Button className={styles.copy} onClick={onClose}>Done</Button>
                <button type="button" className={styles.helpToggle} onClick={() => setAddOpen(true)}>
                  Add another device
                </button>
              </div>
            ) : (
              <>
                <div className={styles.step}>
                  <OsPicker value={choice} onChange={setChoice} />

                  {choice === "mac-app" ? (
                    <MacInstall onStarted={() => { setStarted(true); onStarted?.(); }} />
                  ) : command ? (
                    <div className={styles.step}>
                      <pre className={styles.text} tabIndex={0} aria-label="Install and start command">
                        {command}
                      </pre>
                      <Button className={styles.copy} onClick={() => void copy("connect", command)}>
                        <Icon name={copied === "connect" ? "check" : "copy"} size={14} />
                        {copied === "connect" ? "Copied" : "Copy command"}
                      </Button>
                      <p className={styles.scope}>{pasteIn}</p>
                      {copyError("connect")}
                    </div>
                  ) : (
                    <p className={styles.error} role="alert">{CONNECT_COMMAND_ERROR}</p>
                  )}
                </div>

                {showProgress && (
                  <LiveStatus
                    stage={ping.stage}
                    elapsedMs={ping.elapsedMs}
                    showElapsed={attemptCopy !== null || started}
                    device={ping.device}
                    tool={ping.tool}
                    anchor={progress}
                  />
                )}
                {showProgress && !addOpen && installed && installed.lead !== "Your account is already connected." && (
                  <p className={styles.installedLead}>{installed.lead}</p>
                )}
                {showProgress && (staleNow && staleHint ? (
                  <p className={styles.staleFix}>{staleHint.fix}</p>
                ) : ping.stalled && (
                  <p className={styles.staleFix}>
                    {choice === "mac-app" ? "Taking a while? Open VibeHub, click Connect." : "Taking a while? Check Trouble below."}
                  </p>
                ))}

                {/* One quiet disclosure for everything else (ADHD rule 2): fixes, the
                    already-installed note, and what the tracker reads and sends. */}
                {(choice !== "mac-app" || installed?.detail || staleHint) && <div className={styles.help}>
                  <button
                    type="button"
                    className={styles.helpToggle}
                    aria-expanded={detailsOpen}
                    aria-controls={`${id}-data`}
                    onClick={() => setDetailsOpen((v) => !v)}
                  >
                    Trouble? {detailsOpen ? "▴" : "▾"}
                  </button>
                  {detailsOpen && (
                    <div id={`${id}-data`} className={cx(styles.stepDetails, "fade-in")}>
                      <ul className={styles.helpList}>
                        {choice !== "mac-app" && <>
                          <li>Copying does not run setup. Paste the command into PowerShell or Terminal.</li>
                          <li>A browser tab opens to approve this device. Click &ldquo;Allow&rdquo;.</li>
                          <li>Keep the terminal open until it says connected.</li>
                        </>}
                        {installed?.detail && <li>{installed.detail}</li>}
                        {staleHint && <li>{staleHint.lead} {staleHint.fix}</li>}
                      </ul>
                      {choice !== "mac-app" && <>
                      <p className={styles.explain}>{DEVICE_CONNECT_SCOPE}</p>
                      <p className={styles.explain}>{NODE_SETUP_NOTICE}</p>
                      <p className={styles.explain}>{INSTALL_START_MEANS} {BACKGROUND_START_MEANS}</p>
                      <p className={styles.explain}>{TRACKER_LOCAL_READS}</p>
                      <p className={styles.explain}>{TRACKER_UPLOADS} {TRACKER_VISIBILITY}</p>
                      <p className={styles.explain}>{TRACKER_SUPPORT_NOTICE} {TRACKER_SUPPORT_DETAILS}</p>
                      <p className={styles.explain}>{TRACKER_STATE_NOTICE}</p>
                      <p className={styles.explain}>{TRACKER_CONTROL_NOTICE} {TRACKER_HISTORY_NOTICE}</p>
                      </>}
                    </div>
                  )}
                </div>}
              </>
            )}
          </div>
        </div>
      </div>
      {celebration}
    </>,
    document.body,
  );
}
