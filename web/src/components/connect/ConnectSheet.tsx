import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { API_BASE } from "../../lib/api";
import {
  BACKGROUND_START_MEANS,
  buildConnectPrompt,
  buildInstallCommand,
  buildStartCommand,
  buildStatusCommand,
  buildStopCommand,
} from "../../lib/connectPrompt";
import type { ConnectPromptTarget, InstallOs } from "../../lib/connectPrompt";
import {
  claimConnectCelebration,
  deviceLabel,
  detectOs,
  ensureConnectToken,
} from "../../lib/connectToken";
import type { StoredConnectToken } from "../../lib/connectToken";
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
import styles from "./ConnectSheet.module.css";

const WEB_URL = window.location.origin;
const EXIT_MS = 200;

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** "Terminal" is not a prompt target — it is the install one-liner. The other four are
 *  agentic tools that run it themselves. ChatGPT is deliberately absent: it cannot run
 *  commands, and its walk-through belongs in a chat, not in this sheet. */
type How = "terminal" | ConnectPromptTarget;

const HOWS: { id: How; label: string }[] = [
  { id: "terminal", label: "Terminal" },
  { id: "cursor", label: "Cursor" },
  { id: "codex", label: "Codex" },
  { id: "quadcode", label: "Quadcode AI" },
  { id: "claude-code", label: "Claude Code" },
];

const OSES: { id: InstallOs; label: string }[] = [
  { id: "mac", label: "macOS / Linux" },
  { id: "windows", label: "Windows" },
];

/** One line: what pasting it does. Installing is not starting, and the sheet must not
 *  promise otherwise. */
const EXPLAIN: Record<How, string> = {
  terminal: "Run in your terminal.",
  cursor: "Paste into Cursor. It installs, then asks before starting.",
  codex: "Paste into Codex. It installs, then asks before starting.",
  quadcode: "Paste into Quadcode AI. It installs, then asks before starting.",
  "claude-code": "Paste into Claude Code. It installs, then asks before starting.",
  chatgpt: "Paste into ChatGPT. It walks you through install, then asks before starting.",
};

/** Which command the clipboard last took. Never a claim that it was run. */
type Copied = "install" | "start" | null;

/**
 * Row 0 reports what *this browser* did, and nothing more.
 *
 * Copying is not installing and not starting — the command may still be sitting
 * unpasted in a terminal that was never opened — so the label names the command that
 * was copied rather than implying it ran. When nothing was copied the browser refused
 * the clipboard write; the command is on screen and the wait runs anyway.
 *
 * There is deliberately no "already set up" branch. This browser cannot know that:
 * presence says something is pinging *now*, never that an install exists, and a
 * stored token only proves a token was minted once.
 */
const firstStep = (copied: Copied) =>
  copied === "install" ? "Install copied" : copied === "start" ? "Start copied" : "Copy the command above";

/* ---- segmented picker (same markup and roles as ConnectTools') ---- */

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

/* ---- step 2 ---- */

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
  copied: Copied;
  /** The sheet scrolls this into view the first time the block appears. */
  anchor: RefObject<HTMLDivElement>;
  /**
   * A revoked token was rejected *after* this attempt started waiting — already gated
   * by staleSinceWaiting at the call site. It is the reason the ping is not arriving,
   * so it takes the place of the neutral waiting line rather than sitting beside it:
   * "Waiting for first ping…" next to "your tracker is failing to ping" reads as two
   * unrelated facts, and the neutral one is the one that sounds like progress.
   */
  stale: StaleTrackerHintCopy | null;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  // Three rows, not four: the old list spent two on the same fact (a ping arrived, and
  // then that it counted). Row 0 is this browser's own business; rows 1 and 2 are the
  // server's word — a ping the account actually received — never something inferred
  // from a click.
  const waitingLabel = stage === "waiting" && stale ? stale.lead : "Waiting for first ping…";
  const rows = [firstStep(copied), stage === "waiting" ? waitingLabel : "First ping", "Connected"];
  const done = stage === "waiting" ? 1 : stage === "pinged" ? 2 : 3;
  const active = stage === "live" ? -1 : done;

  // The timer sits on row 1 while waiting; once a ping has landed the same row carries
  // which device and tool it came from.
  const detail = (i: number) => {
    if (i !== 1) return null;
    if (stage === "waiting") {
      return (
        <span className={styles.elapsed} aria-label={`${formatElapsed(elapsedMs)} elapsed`}>
          {formatElapsed(elapsedMs)}
        </span>
      );
    }
    if (device) {
      return <span className={styles.stepMeta}>{[device, tool && toolLabel(tool)].filter(Boolean).join(" · ")}</span>;
    }
    return null;
  };

  return (
    <div className={styles.step} ref={anchor}>
      <h3 className={styles.stepTitle}>3 · Connecting</h3>

      <ol className={styles.progress}>
        {rows.map((label, i) => (
          <li
            key={label}
            className={cx(styles.pstep, i < done && styles.pstepDone, i === active && styles.pstepActive)}
          >
            <span className={styles.pmark} aria-hidden="true">
              {i < done ? <Icon name="check" size={12} /> : <span className={styles.pdot} />}
            </span>
            <span className={styles.plabel}>
              {label}
              {detail(i)}
            </span>
            {/* 1px indeterminate line, monochrome, only under the step in progress. */}
            {i === active && <span className={styles.pline} aria-hidden="true" />}
          </li>
        ))}
      </ol>

      {/* The instruction half, under the list. Steps 1 and 2 are untouched above it —
          this says to run them again, so it must not be in their way. */}
      {stage === "waiting" && stale && <p className={styles.staleFix}>{stale.fix}</p>}

      {stalled && (
        <div className={styles.help}>
          <button
            type="button"
            className={styles.helpToggle}
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((v) => !v)}
          >
            Still waiting? Common fixes
          </button>
          {helpOpen && (
            <ul className={cx(styles.helpList, "fade-in")}>
              {/* First, because it is the likeliest one: installing no longer starts
                  anything, so a perfectly successful install waits here forever until
                  step 2 is actually run. */}
              <li>Step 2 hasn't run yet, or your agent is waiting for your yes.</li>
              <li>Node.js 18+ missing, or the terminal closed early.</li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- the sheet ---- */

interface Props {
  open: boolean;
  onClose: () => void;
  /** The person copied a command — an attempt is under way (round 12: lets the card
   *  behind the sheet say "Waiting…" only once there is something to wait for). */
  onStarted?: () => void;
}

/**
 * "Go online" — the one place that explains how to start the tracker, opened from every
 * self surface that says it is offline (Home strip, tracker panel, profile hero,
 * Settings) and from ConnectTools' never-connected card.
 *
 * Two steps, not a wall of text: pick how you work, then watch it connect. It owns the
 * token, the copy and the poll, so no entry point duplicates any of that.
 *
 * Bottom sheet on phones, centered dialog on desktop. Focus moves in on open and back to
 * the opener on close, Tab is trapped, Escape and the backdrop close it.
 */
export function ConnectSheet({ open, onClose, onStarted }: Props) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [how, setHow] = useState<How>("terminal");
  const [os, setOs] = useState<InstallOs>(detectOs);
  /** The minted token *and* whose it is. Scoped because a token is per user and a
   *  plain value would keep showing the previous account's token for the render
   *  between a user change and the mint effect that replaces it. Matching on
   *  userId at render time closes that window entirely rather than narrowing it. */
  const [minted, setMinted] = useState<{ userId: string; token: StoredConnectToken } | null>(null);
  const token = minted && minted.userId === userId ? minted.token : null;
  const [copied, setCopied] = useState<Copied>(null);
  /** Which block the message belongs under. A copy failure used to render as the last
   *  child of the sheet body — under step 2, under the whole progress list, and under
   *  the stalled help once that opened — about 400px from the button it was about,
   *  while saying "the command above" with two commands above it. Errors go next to
   *  their control (skills/emil_design_eng §5). */
  const [error, setError] = useState<{ what: NonNullable<Copied>; message: string } | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  /** The reinstall caveat is disclosure-only — see installedNote. */
  const [noteOpen, setNoteOpen] = useState(false);
  /** Step 2 reference block, closed by default. */
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Started = this browser has begun watching for a ping, because the person took an
  // action here. It is a reason to *look*, never a claim that anything was installed
  // or started — every step past the first comes from the server.
  //
  // A token minted on an earlier visit used to set this on open. It no longer does: a
  // token in localStorage says a token was created once, which is not evidence that
  // the tracker was ever installed, let alone started, and showing "Waiting for the
  // tracker to start" to someone who has done nothing this session is a lie the sheet
  // then has to keep for 90 seconds. The already-live case does not need it — that
  // rests on `liveAtOpen`, which useTrackerPing reads from presence.
  const [started, setStarted] = useState(false);

  const { render, closing } = useExitTransition(open, EXIT_MS);
  const ping = useTrackerPing(open, started);
  const showProgress = ping.stage !== "idle";

  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const progress = useRef<HTMLDivElement>(null);
  /** Identity of what is currently on screen to copy. Bumped whenever the tool,
   *  the OS, the user or the open state changes, so a clipboard promise that
   *  resolves after one of those can tell that it is answering a stale question. */
  const generation = useRef(0);

  // Anything that changes what the buttons would put on the clipboard retires the
  // "Copied" badge and any error under it — switching tool or OS rewrites the
  // command, so a badge earned by the previous one is a claim about text that is
  // no longer on screen. Bumping the generation also retires a clipboard write
  // still in flight (see `copy`).
  useEffect(() => {
    generation.current += 1;
    setCopied(null);
    setError(null);
  }, [how, os, userId, open]);

  // A fresh open is a fresh attempt.
  useEffect(() => {
    if (!open) return;
    setStarted(false);
    setNoteOpen(false);
    setDetailsOpen(false);
  }, [open, userId]);

  // Mint once per browser; `ensureConnectToken` dedupes in-flight calls, so opening the
  // sheet from two surfaces in one session still yields one token.
  useEffect(() => {
    if (!open || !userId || token) return;
    let cancelled = false;
    ensureConnectToken(userId, deviceLabel(detectOs()))
      .then((t) => {
        if (!cancelled) setMinted({ userId, token: t });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError({ what: "install", message: err instanceof Error ? err.message : "Could not create a token" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, userId, token]);

  const text = useMemo(() => {
    if (!token) return null;
    return how === "terminal"
      ? buildInstallCommand(os, token.token, API_BASE, WEB_URL)
      : buildConnectPrompt(how, token.token, API_BASE, WEB_URL);
  }, [token, how, os]);

  // Step 2's commands never carry the token — it is already in ~/.vibehub/config.json
  // by the time any of these are run. Available before step 1 has been done, on
  // purpose: this is also the way out when an agent refuses to start the daemon.
  const startCmd = buildStartCommand(os);
  const statusCmd = buildStatusCommand(os);
  const stopCmd = buildStopCommand(os);

  const copy = async (what: NonNullable<Copied>, value: string) => {
    // Which command this call is about. `navigator.clipboard.writeText` can resolve a
    // tick or several later — long enough for the reader to switch tool or OS, close
    // the sheet, or for the account to change — and a result that lands after any of
    // those would badge a command that is no longer the one on screen.
    const mine = generation.current;
    const stale = () => generation.current !== mine;

    // The wait starts either way. A clipboard the browser refused (permissions, an
    // insecure origin, an embedded webview) does not mean the command will not be run
    // — the text is on screen and the message says to select it. Withholding progress
    // in that case leaves the one person who most needs it watching nothing.
    setStarted(true);
    onStarted?.();
    setError(null);
    try {
      await navigator.clipboard.writeText(value);
      if (stale()) return;
      setCopied(what);
    } catch {
      if (stale()) return;
      setCopied(null);
      setError({ what, message: "Copy failed — select the command above." });
    }
  };

  // Done: celebrate once across every surface, then close and let the strip and panel
  // flip live on their own next poll.
  //
  // Only for the *transition* into live. An account that was already tracking when the
  // sheet opened — which is what `/?connect=1` does from the menu-bar app — has nothing
  // to congratulate, and closing on it would slam the sheet shut on someone who asked
  // to see it. That case rests on the finished step list instead.
  useEffect(() => {
    if (!shouldCelebrate(ping.stage, ping.liveAtOpen)) return;
    // Shared, per-user gate: whichever surface sees the connection first celebrates, and
    // the other does not repeat it. Closing is unconditional — the sheet is finished
    // either way.
    if (userId && claimConnectCelebration(userId)) setCelebrating(true);
    onClose();
  }, [ping.stage, ping.liveAtOpen, userId, onClose]);

  // ---- modal mechanics ----
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the dialog itself rather than the first control: a segmented picker that
    // grabs focus reads as "you have already chosen".
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      opener.current?.focus();
    };
  }, [open]);

  // Copy is at the top of the sheet and the step list it creates is at the bottom, so
  // on a 900px window — and on every phone — the answer to "did that do anything?"
  // appeared off-screen. Bring it into the body's view when it first appears.
  //
  // Only a copy made in *this* opening earns the scroll. The copied flags persist, so
  // a sheet that reopens with the block already there must open at the top — scrolled,
  // "1 · Install" landed under the header on a 390px phone (round 11 prod pass).
  const progressAtOpen = useRef(false);
  useEffect(() => {
    if (open) progressAtOpen.current = showProgress;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sampled at open only
  }, [open]);
  useEffect(() => {
    if (!showProgress) {
      progressAtOpen.current = false;
      return;
    }
    if (progressAtOpen.current) {
      progressAtOpen.current = false;
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Two frames, not one: the block mounts its three rows and the sweep line in the
    // same commit, and a scroll measured before that settles lands ~36px short.
    // `end` rather than `nearest` — the newest row is the one worth seeing.
    const id = window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() =>
        progress.current?.scrollIntoView({ block: "end", behavior: reduced ? "auto" : "smooth" })
      )
    );
    return () => window.cancelAnimationFrame(id);
  }, [showProgress]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialog.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // The dialog itself holds focus on open (tabIndex={-1}, focused so the sheet is
      // announced without a control reading as already-chosen). It is not in
      // `focusable`, so it matched neither boundary and Shift+Tab walked straight out
      // of the sheet — the trap only ever caught the forward edge. Treat "focus is on
      // the dialog, or has escaped it entirely" as being at whichever edge the reader
      // is travelling towards.
      const insideControl =
        active instanceof HTMLElement && active !== dialog.current && dialog.current?.contains(active);
      if (!insideControl) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const celebration = (
    <ConnectCelebration
      open={celebrating}
      status={ping.status}
      onRefresh={async () => {}}
      onClose={() => setCelebrating(false)}
    />
  );

  if (!render) return celebration;


  const installed = installedNote(ping.status, agoShort);
  // Same rule as Home and Settings, plus one the ambient surfaces do not need: the sheet
  // is read as a report on the command just run, so it only speaks when the rejection
  // landed after this attempt began waiting. A revoked token rejected this morning is a
  // true fact about the account and a lie about the paste that just happened.
  const staleHint = staleTrackerHint(ping.status);
  const staleNow = staleSinceWaiting(staleHint, ping.waitingSince);

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
              Go online
            </h2>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
              <Icon name="x" size={16} />
            </button>
          </header>

          <div className={styles.body}>
            {/* Context before the choice, not wedged between the step title and its
                control. No box — one border per block, and this is a sentence. */}
            {installed && (
              <div className={styles.installed}>
                <p className={styles.installedLead}>{installed.lead}</p>
                {installed.detail && (
                  <>
                    <button
                      type="button"
                      className={styles.helpToggle}
                      aria-expanded={noteOpen}
                      onClick={() => setNoteOpen((v) => !v)}
                    >
                      Already installed?
                    </button>
                    {noteOpen && <p className={cx(styles.installedDetail, "fade-in")}>{installed.detail}</p>}
                  </>
                )}
              </div>
            )}

            <div className={styles.step}>
              <h3 className={styles.stepTitle}>1 · Install</h3>
              <Segment label="How you work" options={HOWS} value={how} onChange={setHow} />

              <p className={styles.explain}>{EXPLAIN[how]}</p>
              {/* One OS picker for the whole sheet: it chooses the install one-liner
                  only for Terminal, but it always chooses step 2's commands. */}
              <div className={styles.osRow}>
                <Segment label="Operating system" options={OSES} value={os} onChange={setOs} />
                <span className={styles.note}>Needs Node.js 18+.</span>
              </div>

              {text ? (
                <>
                  <pre className={styles.text}>{text}</pre>
                  <Button className={styles.copy} onClick={() => void copy("install", text)}>
                    <Icon name={copied === "install" ? "check" : "copy"} size={14} />
                    {copied === "install" ? "Copied" : "Copy"}
                  </Button>
                </>
              ) : (
                <>
                  <Skeleton variant="block" height={72} width="100%" />
                  <Skeleton variant="pill" height={38} width="100%" />
                </>
              )}
              {/* Outside the ternary on purpose: a mint failure is exactly the case
                  where `text` is null, and an error rendered only in the other branch
                  would be the one error nobody ever sees. */}
              {error?.what === "install" && (
                <p className={styles.error} role="alert">
                  {error.message}
                </p>
              )}

              {/* Offered before anything has gone wrong, not after. An agent that
                  refuses to start a background process is behaving correctly, and the
                  person should never have to come back and ask the sheet for a way
                  out — it is already on screen. */}
              {how !== "terminal" && (
                <button type="button" className={styles.helpToggle} onClick={() => setHow("terminal")}>
                  Agent blocked it? Use Terminal
                </button>
              )}
            </div>

            <div className={styles.step}>
              <h3 className={styles.stepTitle}>2 · Start</h3>
              {/* Copying is all this page can do. The command runs on the reader's
                  machine, when they choose to run it — the browser starts nothing. */}
              <p className={styles.explain}>Run in your own terminal. Runs in the background until you stop it.</p>

              <pre className={styles.text}>{startCmd}</pre>
              <Button
                variant="secondary"
                className={styles.copy}
                onClick={() => void copy("start", startCmd)}
              >
                <Icon name={copied === "start" ? "check" : "copy"} size={14} />
                {copied === "start" ? "Copied" : "Copy"}
              </Button>
              {error?.what === "start" && (
                <p className={styles.error} role="alert">
                  {error.message}
                </p>
              )}

              {/* The full consent sentence and the other two verbs are reference, not
                  the thing to press — one disclosure rather than three paragraphs. */}
              <button
                type="button"
                className={styles.helpToggle}
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen((v) => !v)}
              >
                Details
              </button>
              {detailsOpen && (
                <div className={cx(styles.stepDetails, "fade-in")}>
                  <p className={styles.installedDetail}>{BACKGROUND_START_MEANS}</p>
                  <p className={styles.note}>
                    Status: <code className={styles.inlineCmd}>{statusCmd}</code>
                    <br />
                    Stop: <code className={styles.inlineCmd}>{stopCmd}</code>
                  </p>
                </div>
              )}
            </div>

            {showProgress && (
              <Progress
                stage={ping.stage as "waiting" | "pinged" | "live"}
                elapsedMs={ping.elapsedMs}
                stalled={ping.stalled}
                device={ping.device}
                tool={ping.tool}
                copied={copied}
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
