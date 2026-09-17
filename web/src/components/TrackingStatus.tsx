import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { TrackerDevice, TrackerSource, TrackerStatus as TrackerStatusData } from "../types";
import {
  formatActiveTime,
  formatTokens,
  humanizeModel,
  modelFamily,
  presenceParts,
  toolFamily,
  toolLabel,
} from "../lib/format";
import { stagger } from "../lib/motion";
import { modelRowLabel } from "../lib/recentModels";
import { sumToday } from "../lib/sources";
import { homeDevices, revokePrompt, showHomeDevices } from "../lib/trackerPing";
import {
  TRACKER_HISTORY_NOTICE,
  TRACKER_LOCAL_READS,
  TRACKER_STATE_NOTICE,
  TRACKER_SUPPORT_NOTICE,
  TRACKER_UPLOADS,
  TRACKER_VISIBILITY,
} from "../lib/connectPrompt";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { ModelGlyph } from "./ui/ModelGlyph";
import { PresenceBlock, useNow } from "./ui/PresenceBlock";
import { Skeleton } from "./ui/Skeleton";
import { StaleTrackerHint } from "./ui/StaleTrackerHint";
import { StatusDot } from "./ui/StatusDot";
import { ToolGlyph } from "./ui/ToolGlyph";
import styles from "./TrackingStatus.module.css";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** "just now" (< 10s), "12s ago", "3m ago", "2h ago", "3d ago" — heartbeat-grained,
 * unlike format.ts's minute-grained elapsedShort. Invalid dates read as "just now". */
export function agoShort(iso: string, now: number = Date.now()): string {
  const raw = now - new Date(iso).getTime();
  const s = Number.isFinite(raw) ? Math.max(0, Math.floor(raw / 1000)) : 0;
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const everyLabel = (ms: number) => `every ${Math.max(1, Math.round(ms / 1000))}s`;

/** Rows the Home panel shows before "+N more" takes over. Settings is the full
 *  explainer and always lists everything; Home is a banner, and an account with a
 *  dozen (tool, model) pairs turned it into a page-long wall. */
const HOME_SOURCE_ROWS = 5;

/* ---- Devices (shared with the not-connected card in ConnectTools) ---- */

interface DeviceListProps {
  devices: TrackerDevice[];
  now: number;
  onRevoke?: (id: string) => Promise<void> | void;
}

/** label · "seen 3m ago" / "never used" · Revoke. One row per non-revoked token. */
export function DeviceList({ devices, now, onRevoke }: DeviceListProps) {
  const [busy, setBusy] = useState<string | null>(null);

  const revoke = async (d: TrackerDevice) => {
    if (!onRevoke) return;
    // A used token is a machine that is reporting; revoking it stops that tracker for
    // good — the daemon gets rejected and only a reinstall brings it back. A ghost button
    // in a list is one slip away, so ask first (Projects do the same before delete). A
    // never-used token is harmless to drop and gets no dialog.
    if (d.lastUsedAt && !window.confirm(revokePrompt(d.label))) return;
    setBusy(d.id);
    try {
      await onRevoke(d.id);
    } finally {
      setBusy(null);
    }
  };

  if (devices.length === 0) return <span className={styles.dim}>No devices yet.</span>;

  return (
    <div className={styles.rows}>
      {devices.map((d) => (
        <div key={d.id} className={styles.row}>
          <span className={styles.rowMain}>
            <span className={styles.rowTool}>{d.label}</span>
          </span>
          <span className={styles.rowRight}>{d.lastUsedAt ? `seen ${agoShort(d.lastUsedAt, now)}` : "never used"}</span>
          {onRevoke && (
            <Button size="sm" variant="ghost" onClick={() => revoke(d)} disabled={busy === d.id}>
              Revoke
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---- Models ---- */

/** One (tool, model) the tracker has seen, led by the model — the same identity the
 *  profile's Models block uses, so the two never disagree about what a model is. */
function SourceRow({ source, now, index }: { source: TrackerSource; now: number; index: number }) {
  const label = modelRowLabel(source.tool, source.model);
  const tool = toolLabel(source.tool);
  const named = humanizeModel(source.model) !== null;

  return (
    <div className={cx(styles.row, styles.rowSource)} style={stagger(index)}>
      <span className={styles.rowMain}>
        <ModelGlyph
          family={named ? modelFamily(source.model) : toolFamily(source.tool)}
          size={14}
          className={styles.rowGlyph}
        />
        <span className={styles.rowTool}>{label}</span>
        {named && (
          <>
            <span className={styles.sep} aria-hidden="true">
              ·
            </span>
            <ToolGlyph family={toolFamily(source.tool)} size={12} className={styles.rowGlyph} />
            <span className={styles.rowModel}>{tool}</span>
          </>
        )}
      </span>
      <span className={styles.rowRight}>
        <span className={styles.rowTokens}>{formatTokens(source.tokensToday)} today</span>
        <span className={styles.sep} aria-hidden="true">
          ·
        </span>
        <span>{agoShort(source.lastSeenAt, now)}</span>
      </span>
    </div>
  );
}

/* ---- Title ---- */

/** One word per state, and the same word everywhere it appears. "Connected" is the
 *  only one painted in --vh-live. An account that has heartbeated before but is silent
 *  now reads "Offline", not "Waiting…" — the tracker is what stopped, and that is what
 *  the person needs to know (round-7 prod pass). */
export function trackerTitle(status: TrackerStatusData): string {
  if (status.presence.status === "active") return "Connected";
  if (status.presence.status === "idle") return "Idle";
  return status.lastSeenAt ? "Offline" : "Waiting…";
}

/* ---- Strip ----
 * What Home keeps once the explainer has been dismissed: one line that answers
 * "is anything being tracked right now?" without a click, so it never hides itself.
 *
 *   ● Connected   in vibehub · ⌥ Cursor · ✦ Claude Sonnet 5 · for 12m          1.6k tokens · 34m today   Tracker settings
 *   ● Offline     last heartbeat 2h ago                                        1.6k tokens · 34m today   Tracker settings
 *
 * Same dot, same title, same counter as the panel above — a smaller cut of the
 * same thing, not a second design. Wraps to two rows under 640px. */

export interface TrackingStripProps {
  status: TrackerStatusData;
  settingsHref?: string;
  /** Opens the connect sheet. Rendered only while offline — idle means the tracker is
   *  still talking, so there is nothing to go and do (round 8C). */
  onGoOnline?: () => void;
  className?: string;
}

export function TrackingStrip({ status, settingsHref, onGoOnline, className }: TrackingStripProps) {
  const now = useNow(true, 5000);
  const presence = status.presence;
  const live = presence.status === "active";
  const activity = presence.status !== "offline" ? presence.activity : null;
  const parts = activity ? presenceParts(activity, now) : null;
  const today = sumToday(status.sources);
  const heartbeat = status.lastSeenAt ? `last ping ${agoShort(status.lastSeenAt, now)}` : "no ping yet";

  return (
    <Card className={cx(styles.strip, className)} data-live={live || undefined} aria-label="Your tracker">
      <StatusDot status={presence.status} pulse={live} size={10} className={styles.stripDot} />

      <div className={styles.stripMain}>
        <strong className={cx(styles.title, live && styles.titleLive)}>{trackerTitle(status)}</strong>
        {activity && parts ? (
          <span className={styles.stripActivity}>
            <span className={styles.stripIn}>in</span>
            <span className={styles.stripProject}>{parts.project}</span>
            {/* Each "·" lives inside the pair it introduces. `.stripPair` is nowrap, so
                when the line breaks on a phone the dot travels with its tool or model
                instead of dangling at the end of the previous row (round 11, 390px). */}
            <span className={styles.stripPair}>
              <span className={styles.sep} aria-hidden="true">
                ·
              </span>
              <ToolGlyph family={toolFamily(activity.tool)} size={13} className={styles.rowGlyph} />
              <span>{parts.tool}</span>
            </span>
            {parts.model && (
              <span className={styles.stripPair}>
                <span className={styles.sep} aria-hidden="true">
                  ·
                </span>
                <ModelGlyph family={modelFamily(activity.model)} size={13} className={styles.rowGlyph} />
                <span className={styles.stripModel}>{parts.model}</span>
              </span>
            )}
            {live && (
              <span className={styles.stripElapsed}>
                {parts.elapsed === "just now" ? "just now" : `for ${parts.elapsed}`}
              </span>
            )}
          </span>
        ) : (
          <span className={styles.meta}>{heartbeat}</span>
        )}
      </div>

      <span className={styles.stripRight}>
        <span className={styles.stripCounter}>
          <span className={styles.stripValue}>
            {today.estimated ? "~" : ""}
            {formatTokens(today.tokens)}
          </span>
          <span className={styles.counterUnit}>tokens</span>
          <span className={styles.sep} aria-hidden="true">
            ·
          </span>
          <span className={styles.stripValue}>{formatActiveTime(today.activeSeconds)}</span>
          <span className={styles.counterUnit}>today</span>
        </span>
        {onGoOnline && presence.status === "offline" && (
          <Button size="sm" onClick={onGoOnline} className={styles.goOnline}>
            Go online
          </Button>
        )}
        {settingsHref && (
          <Link to={settingsHref} className={styles.link}>
            Tracker settings
          </Link>
        )}
      </span>

      {/* Its own row under the strip — i.e. under "Go online", which is the thing it is
          about. Renders nothing unless the tracker is offline *and* the server says a
          revoked token is still heartbeating, so the one-line strip stays one line in
          every other case. */}
      <StaleTrackerHint status={status} className={styles.stripHint} />
    </Card>
  );
}

/* ---- Panel ---- */

export interface TrackingStatusProps {
  /** home = first-time explainer on the Home page (Got it + settings link);
   * settings = the permanent panel in Settings › Tracker (always lists devices). */
  variant: "home" | "settings";
  /** null renders the shape-matched skeleton. */
  status: TrackerStatusData | null;
  /** Home only — "Got it". */
  onDismiss?: () => void;
  /** Opens the connect sheet. Rendered only while offline — idle means the tracker is
   *  still talking, so there is nothing to go and do (round 8C). */
  onGoOnline?: () => void;
  onRevoke?: (id: string) => Promise<void> | void;
  /** Mints a new device token; the wrapper then passes the install block as `addDeviceBlock`. */
  onAddDevice?: () => void;
  addingDevice?: boolean;
  addDeviceBlock?: ReactNode;
  /** Renders a small "Tracker settings" link in the footer when set. */
  settingsHref?: string;
  error?: string | null;
  /** Enter/leave classes from the wrapper ("reveal" / "leave") and spacing. */
  className?: string;
}

/**
 * "What got connected, and is it tracking?" — the connected half of ConnectTools,
 * and what the celebration layer leaves behind, showing the same two numbers so the
 * panel is never a blank frame after the fireworks stop.
 *
 *   ● Connected                            ← green only here (dot + title)
 *     last heartbeat 12s ago · every 30s
 *   Today          1.2k tokens · 34m active
 *   Now            Online · in vibehub · Claude Code · Claude Fable 5.1 · for 12m
 *   Models         ✦ Claude Fable 5.1 · ⌘ Claude Code       160 today · 12s ago
 *   Devices        Windows · Sep 4 · seen 12s ago · Revoke   (settings; home only if > 1 *used*)
 *   Supported AI-log metadata; local reads and public stats disclosed.   [Got it]
 *
 * Relative times re-render every 5s. The wrapper owns polling and realtime.
 */
export function TrackingStatus({
  variant,
  status,
  onDismiss,
  onGoOnline,
  onRevoke,
  onAddDevice,
  addingDevice = false,
  addDeviceBlock,
  settingsHref,
  error,
  className,
}: TrackingStatusProps) {
  const now = useNow(status !== null, 5000);
  const [allSources, setAllSources] = useState(false);

  if (!status) {
    // Shape-matched, section for section: head, Today, Now, a full Models list and
    // the footer. Two rows and no footer left a ~440px jump when the status landed,
    // and this panel is the first thing on Home — everything under it moved.
    return (
      <Card className={cx(styles.panel, className)} aria-busy="true">
        <div className={styles.head}>
          <Skeleton variant="circle" width={10} className={styles.headDot} />
          <div className={styles.headText}>
            <Skeleton width={120} height={14} />
            <Skeleton width={190} height={12} />
          </div>
        </div>
        <div className={styles.section}>
          <Skeleton width={38} height={12} />
          <Skeleton width={168} height={17} />
        </div>
        <div className={styles.section}>
          <Skeleton width={30} height={12} />
          <Skeleton width="55%" height={13} />
          <Skeleton width="40%" height={13} />
        </div>
        <div className={styles.section}>
          <Skeleton width={54} height={12} />
          {Array.from({ length: HOME_SOURCE_ROWS }, (_, i) => (
            <div key={i} className={styles.row}>
              <span className={styles.rowMain}>
                <Skeleton variant="circle" width={14} />
                <Skeleton width="45%" height={13} />
              </span>
              <span className={styles.rowRight}>
                <Skeleton width={96} height={12} />
              </span>
            </div>
          ))}
        </div>
        <div className={styles.section}>
          <Skeleton width={54} height={12} />
          {[0, 1].map((i) => (
            <div key={i} className={styles.row}>
              <span className={styles.rowMain}>
                <Skeleton width="28%" height={13} />
              </span>
              <span className={styles.rowRight}>
                <Skeleton width={82} height={12} />
              </span>
            </div>
          ))}
        </div>
        <div className={styles.footer}>
          <div className={styles.privacy}>
            <Skeleton width="82%" height={12} />
          </div>
          <div className={styles.actions}>
            <Skeleton width={96} height={38} />
          </div>
        </div>
      </Card>
    );
  }

  const live = status.presence.status === "active";
  const offline = status.presence.status === "offline";
  const running = !offline && status.presence.activity !== null;
  // Home lists only machines that have actually reported (a never-used token minted by
  // opening the sheet is not one); Settings lists every non-revoked token — Revoke lives there.
  const devices = variant === "settings" ? status.devices : homeDevices(status.devices);
  const showDevices = variant === "settings" || showHomeDevices(status.devices);
  const capSources = variant === "home" && !allSources && status.sources.length > HOME_SOURCE_ROWS;
  const sources = capSources ? status.sources.slice(0, HOME_SOURCE_ROWS) : status.sources;
  const heartbeat = status.lastSeenAt ? `last ping ${agoShort(status.lastSeenAt, now)}` : "no ping yet";
  const today = sumToday(status.sources);

  return (
    <Card className={cx(styles.panel, className)} data-live={live || undefined}>
      <div className={styles.head}>
        <StatusDot status={status.presence.status} pulse={live} size={10} className={styles.headDot} />
        <div className={styles.headText}>
          <strong className={cx(styles.title, live && styles.titleLive)}>{trackerTitle(status)}</strong>
          <span className={styles.meta}>
            {heartbeat} · {everyLabel(status.heartbeatIntervalMs)}
          </span>
          {/* Directly under the status word, because it is what "Offline" is failing to
              explain. Shared by both variants: Settings' permanent panel and Home's
              first-run explainer ask the same question, and only one is ever on screen. */}
          <StaleTrackerHint status={status} className={styles.headHint} />
        </div>
      </div>

      {/* The same counter the celebration layer showed, so closing it reveals the
          numbers already filled in rather than an empty panel. */}
      <section className={styles.section} aria-label="Today">
        <span className={styles.label}>Today</span>
        <span className={styles.counter}>
          <span className={styles.counterValue}>
            {today.estimated ? "~" : ""}
            {formatTokens(today.tokens)}
          </span>
          <span className={styles.counterUnit}>tokens</span>
          <span className={styles.sep} aria-hidden="true">
            ·
          </span>
          <span className={styles.counterValue}>{formatActiveTime(today.activeSeconds)}</span>
          <span className={styles.counterUnit}>active</span>
        </span>
      </section>

      <section className={styles.section} aria-label="Now">
        <span className={styles.label}>Now</span>
        {running ? (
          <PresenceBlock presence={status.presence} variant="row" />
        ) : (
          <span className={styles.dim}>No recent supported AI activity</span>
        )}
      </section>

      <section className={styles.section} aria-label="Models">
        <span className={styles.label}>Models</span>
        {status.sources.length === 0 ? (
          <span className={styles.dim}>No supported AI activity yet.</span>
        ) : (
          <>
            <div className={cx(styles.rows, "stagger")}>
              {sources.map((s, i) => (
                <SourceRow key={`${s.tool}|${s.model ?? "no-model"}`} source={s} now={now} index={i} />
              ))}
            </div>
            {variant === "home" && status.sources.length > HOME_SOURCE_ROWS && (
              <button type="button" className={styles.more} onClick={() => setAllSources((v) => !v)}>
                {capSources ? `${status.sources.length - HOME_SOURCE_ROWS} more` : "Show fewer"}
              </button>
            )}
          </>
        )}
      </section>

      {showDevices && (
        <section className={styles.section} aria-label="Devices">
          <span className={styles.label}>Devices</span>
          {/* Home lists devices so a second machine is visible, but revoking one is
              destructive and belongs with the rest of the tracker controls. */}
          <DeviceList devices={devices} now={now} onRevoke={variant === "settings" ? onRevoke : undefined} />
          {onAddDevice && !addDeviceBlock && (
            <div>
              <Button size="sm" variant="secondary" onClick={onAddDevice} disabled={addingDevice}>
                {addingDevice ? "Creating…" : "Add device"}
              </Button>
            </div>
          )}
          {addDeviceBlock}
        </section>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <footer className={styles.footer}>
        <p className={styles.privacy}>
          {TRACKER_LOCAL_READS} {TRACKER_UPLOADS} {TRACKER_VISIBILITY} {TRACKER_SUPPORT_NOTICE} {TRACKER_STATE_NOTICE} {TRACKER_HISTORY_NOTICE} Stop locally from Status, Stop &amp; reconnect. Revoke removes reporting authorization, not guaranteed local shutdown or history erasure.
        </p>
        {(onDismiss || settingsHref || onGoOnline) && (
          <div className={styles.actions}>
            {!offline && onGoOnline && (
              <Button variant="secondary" onClick={onGoOnline}>
                Status, Stop &amp; reconnect
              </Button>
            )}
            {settingsHref && (
              <Link to={settingsHref} className={styles.link}>
                Tracker settings
              </Link>
            )}
            {/* Offline is the one state with something to do about it, so it gets the
                only filled button, and it goes last: rightmost on a desktop row, and
                topmost once .actions reverses into a column on a phone. "Got it"
                drops to a quiet ghost beside it rather than competing. */}
            {onDismiss && (
              <Button
                onClick={onDismiss}
                variant={offline && onGoOnline ? "ghost" : "primary"}
                className={styles.primary}
              >
                Got it
              </Button>
            )}
            {offline && onGoOnline && (
              <Button onClick={onGoOnline} className={styles.primary}>
                Go online
              </Button>
            )}
          </div>
        )}
      </footer>
    </Card>
  );
}
