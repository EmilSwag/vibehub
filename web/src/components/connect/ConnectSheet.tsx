import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { API_BASE } from "../../lib/api";
import { buildConnectPrompt, buildInstallCommand } from "../../lib/connectPrompt";
import type { ConnectPromptTarget, InstallOs } from "../../lib/connectPrompt";
import {
  claimConnectCelebration,
  deviceLabel,
  detectOs,
  ensureConnectToken,
  readStoredConnectToken,
} from "../../lib/connectToken";
import type { StoredConnectToken } from "../../lib/connectToken";
import { useExitTransition } from "../../lib/motion";
import { formatElapsed, useTrackerPing } from "../../lib/useTrackerPing";
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

/** Two lines, maximum. The first says what pasting it does; the second is only there
 *  when there is a real prerequisite. */
const EXPLAIN: Record<How, string> = {
  terminal: "Run this in your terminal — it installs the tracker on your machine and starts it",
  cursor: "Paste this into Cursor's chat — it installs the tracker on your machine and starts it",
  codex: "Paste this into Codex — it installs the tracker on your machine and starts it",
  quadcode: "Paste this into Quadcode AI's chat — it installs the tracker on your machine and starts it",
  "claude-code": "Paste this into Claude Code — it installs the tracker on your machine and starts it",
  chatgpt: "Paste this into ChatGPT — it walks you through installing the tracker",
};

const STEPS = [
  "Copied",
  "Waiting for the tracker to start on your machine",
  "First ping received",
  "Tracking works",
];

/** Step one claims the clipboard worked. Two cases where it did not: the browser
 *  refused the write (the command is on screen, the wait is running anyway), and the
 *  deep link arriving on a machine that is already set up and copied nothing. */
const firstStep = (copied: boolean, liveAtOpen: boolean) =>
  copied ? STEPS[0] : liveAtOpen ? "Already set up on this machine" : "Command ready — copy it from above";

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

/**
 * Offline on a machine that already has the tracker. Without this line the sheet reads
 * as a first-time install, and the likeliest fix — open your editor — never gets
 * suggested. Returns null for a genuinely new account, which sees exactly what it saw
 * before: no devices, no line.
 */
function installedNote(status: TrackerStatus | null): string | null {
  if (!status || status.presence.status !== "offline" || status.devices.length === 0) return null;
  // The device that pinged last is the one they are looking at. A server that dated
  // none leaves the first, which is still better than naming no machine at all.
  const dated = status.devices.filter((d) => d.lastUsedAt).sort((a, b) => (a.lastUsedAt! < b.lastUsedAt! ? 1 : -1));
  const device = (dated[0] ?? status.devices[0]).label;
  const last = status.lastSeenAt ? `last ping ${agoShort(status.lastSeenAt)}` : "no ping yet";
  return `Already installed on ${device} — ${last}. Opening your editor usually brings it back — or reinstall below.`;
}

/* ---- step 2 ---- */

function Progress({
  stage,
  elapsedMs,
  stalled,
  device,
  tool,
  copied,
  liveAtOpen,
}: {
  stage: "waiting" | "pinged" | "live";
  elapsedMs: number;
  stalled: boolean;
  device: string | null;
  tool: string | null;
  copied: boolean;
  liveAtOpen: boolean;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  // "Copied" is done the moment we get here; "First ping received" is done as soon as
  // one arrives, which is what makes "Tracking works" the active step after it.
  const done = stage === "waiting" ? 1 : stage === "pinged" ? 3 : STEPS.length;
  const active = stage === "live" ? -1 : done;

  const detail = (i: number) => {
    if (i === 1 && stage === "waiting") {
      return (
        <span className={styles.elapsed} aria-label={`${formatElapsed(elapsedMs)} elapsed`}>
          {formatElapsed(elapsedMs)}
        </span>
      );
    }
    if (i === 2 && device) {
      return <span className={styles.stepMeta}>{[device, tool && toolLabel(tool)].filter(Boolean).join(" · ")}</span>;
    }
    return null;
  };

  return (
    <div className={styles.step}>
      <h3 className={styles.stepTitle}>Pinging your machine</h3>

      <ol className={styles.progress}>
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={cx(styles.pstep, i < done && styles.pstepDone, i === active && styles.pstepActive)}
          >
            <span className={styles.pmark} aria-hidden="true">
              {i < done ? <Icon name="check" size={12} /> : <span className={styles.pdot} />}
            </span>
            <span className={styles.plabel}>
              {i === 0 ? firstStep(copied, liveAtOpen) : label}
              {detail(i)}
            </span>
            {/* 1px indeterminate line, monochrome, only under the step in progress. */}
            {i === active && <span className={styles.pline} aria-hidden="true" />}
          </li>
        ))}
      </ol>

      {stalled && (
        <div className={styles.help}>
          <button
            type="button"
            className={styles.helpToggle}
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((v) => !v)}
          >
            Still waiting — check that the command finished. Common fixes
          </button>
          {helpOpen && (
            <ul className={cx(styles.helpList, "fade-in")}>
              <li>Node.js 18+ has to be installed — the command needs it and stops without it.</li>
              <li>The token got pasted twice. Run the command once, exactly as copied.</li>
              <li>The terminal was closed before it finished. Open it again and re-run.</li>
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
export function ConnectSheet({ open, onClose }: Props) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [how, setHow] = useState<How>("terminal");
  const [os, setOs] = useState<InstallOs>(detectOs);
  const [token, setToken] = useState<StoredConnectToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  // Started = the person has done their part. Copy says so; so does arriving with a
  // token already minted from an earlier visit, because the command is already out
  // there and the only useful thing to show is whether it has landed.
  const [started, setStarted] = useState(false);

  const { render, closing } = useExitTransition(open, EXIT_MS);
  const ping = useTrackerPing(open, started);

  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setError(null);
    setStarted(userId ? readStoredConnectToken(userId) !== null : false);
  }, [open, userId]);

  // Mint once per browser; `ensureConnectToken` dedupes in-flight calls, so opening the
  // sheet from two surfaces in one session still yields one token.
  useEffect(() => {
    if (!open || !userId || token) return;
    let cancelled = false;
    ensureConnectToken(userId, deviceLabel(detectOs()))
      .then((t) => {
        if (!cancelled) setToken(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not create a token");
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

  const copy = async () => {
    if (!text) return;
    // The wait starts either way. A clipboard the browser refused (permissions, an
    // insecure origin, an embedded webview) does not mean the command will not be run
    // — the text is on screen and the message says to select it. Withholding progress
    // in that case leaves the one person who most needs it watching nothing.
    setStarted(true);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError("Copy failed — select the command above and copy it manually.");
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
    if (ping.stage !== "live" || ping.liveAtOpen) return;
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
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
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

  const showProgress = ping.stage !== "idle";
  const installed = installedNote(ping.status);

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
            {installed && <p className={styles.installed}>{installed}</p>}

            <div className={styles.step}>
              <h3 className={styles.stepTitle}>Pick how you work</h3>
              <Segment label="How you work" options={HOWS} value={how} onChange={setHow} />

              <p className={styles.explain}>{EXPLAIN[how]}</p>
              {how === "terminal" && (
                <div className={styles.osRow}>
                  <Segment label="Operating system" options={OSES} value={os} onChange={setOs} />
                  <span className={styles.note}>Needs Node.js 18+.</span>
                </div>
              )}

              {text ? (
                <>
                  <pre className={styles.text}>{text}</pre>
                  <Button className={styles.copy} onClick={copy}>
                    <Icon name={copied ? "check" : "copy"} size={14} />
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </>
              ) : (
                <>
                  <Skeleton variant="block" height={72} width="100%" />
                  <Skeleton variant="pill" height={38} width="100%" />
                </>
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
                liveAtOpen={ping.liveAtOpen}
              />
            )}

            {error && <p className={styles.error}>{error}</p>}
          </div>
        </div>
      </div>
      {celebration}
    </>,
    document.body,
  );
}
