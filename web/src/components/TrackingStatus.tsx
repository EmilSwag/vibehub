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
import { TOKENS_NOT_REPORTED, TOKENS_NOT_REPORTED_TITLE, isTokenlessTool } from "../lib/supportedTools";
import { homeDevices, revokeQuestion, showHomeDevices } from "../lib/trackerPing";
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
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { ModelGlyph } from "./ui/ModelGlyph";
import { PresenceBlock, useNow } from "./ui/PresenceBlock";
import { Skeleton } from "./ui/Skeleton";
import { StaleTrackerHint } from "./ui/StaleTrackerHint";
import { StatusDot } from "./ui/StatusDot";
import { ToolGlyph } from "./ui/ToolGlyph";
import { Icon } from "./ui/Icon";
import { TokenCost } from "./ui/TokenCost";
import { estimateSourceCost, estimateTodayCost } from "../lib/trackerCost";
import { presentTokenCost } from "../lib/tokenCost";
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
  const [confirming, setConfirming] = useState<TrackerDevice | null>(null);

  const revoke = (d: TrackerDevice) => {
    if (!onRevoke) return;
    // A used token is a machine that is reporting; revoking it stops that tracker for
    // good — the daemon gets rejected and only a reinstall brings it back. A ghost button
    // in a list is one slip away, so ask first (Projects do the same before delete). A
    // never-used token is harmless to drop and gets no dialog.
    if (d.lastUsedAt) {
      setConfirming(d);
      return;
    }
    void run(d);
  };

  const run = async (d: TrackerDevice) => {
    if (!onRevoke) return;
    setBusy(d.id);
    try {
      await onRevoke(d.id);
      setConfirming(null);
    } finally {
      setBusy(null);
    }
  };

  if (devices.length === 0) return <span className={styles.dim}>No devices yet.</span>;

  // QA R4: every opened connect sheet used to mint a device, so accounts collected
  // rows of "Mac · Sep 5 — never used". They are not machines: fold them into one line.
  const used = devices.filter((d) => d.lastUsedAt);
  const unused = devices.filter((d) => !d.lastUsedAt);
  const removeUnused = async () => {
    if (!onRevoke) return;
    setBusy("unused");
    try {
      for (const d of unused) await onRevoke(d.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.rows}>
      {used.map((d) => (
        <div key={d.id} className={styles.row}>
          <span className={styles.rowMain}>
            <span className={styles.rowTool}>{d.label}</span>
          </span>
          <span className={styles.rowRight}>
            {d.connected ? "live now" : `seen ${agoShort(d.lastSeenAt ?? d.lastUsedAt!, now)}`}
          </span>
          {onRevoke && (
            <Button size="sm" variant="ghost" onClick={() => revoke(d)} loading={busy === d.id}>
              Revoke
            </Button>
          )}
        </div>
      ))}
      {unused.length > 0 && (
        <div className={styles.row}>
          <span className={styles.rowMain}>
            <span className={styles.dim}>{unused.length === 1 ? "1 unused setup link" : `${unused.length} unused setup links`}</span>
          </span>
          {onRevoke && (
            <Button size="sm" variant="ghost" onClick={() => void removeUnused()} loading={busy === "unused"}>
              Remove
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? revokeQuestion(confirming.label).title : ""}
        body={confirming ? revokeQuestion(confirming.label).body : undefined}
        confirmLabel="Revoke"
        onConfirm={() => (confirming ? run(confirming) : undefined)}
        onClose={() => setConfirming(null)}
      />
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
  const cost = estimateSourceCost(source);

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
        {/* A hook tool's row is a real sighting with no counts behind it. "0 today"
            would read as a measured nothing, which is the one thing the tokenless
            contract forbids (server/src/lib/tools.ts). */}
        <span className={styles.rowTokens} title={isTokenlessTool(source.tool) ? TOKENS_NOT_REPORTED_TITLE : undefined}>
          {isTokenlessTool(source.tool) && source.tokensToday === 0 ? TOKENS_NOT_REPORTED : `${formatTokens(source.tokensToday)} today`}
        </span>
        {(source.cachedTokensToday ?? 0) > 0 && (
          <span className={styles.cached}>{formatTokens(source.cachedTokensToday!)} cached</span>
        )}
        <TokenCost estimate={cost} />
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
 *   (● Connected)  in vibehub · ⌥ Cursor · ✦ Claude Sonnet 5 · for 12m        1.6k tokens   34m today   Tracker settings
 *   (● Offline)    last ping 2h ago                                           1.6k tokens   34m today   Tracker settings
 *
 * Same badge, same word, same counter as the panel above — a smaller cut of the
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
  const todayCost = estimateTodayCost(status.sources, today.tokens);
  const heartbeat = status.lastSeenAt ? `updated ${agoShort(status.lastSeenAt, now)}` : "waiting for first update";

  return (
    <Card className={cx(styles.strip, className)} data-live={live || undefined} aria-label="Your tracker">
      <div className={styles.stripMain}>
        {/* The badge is one object: dot, word, and the live tint behind both. It is the
            same one the panel wears, so the strip stays a smaller cut of that card and
            not a second design — and the dot no longer needs a hand-tuned offset to
            land on the word's line. */}
        <span className={styles.statusPill}>
          <StatusDot status={presence.status} pulse={live} size={8} className={styles.headDot} />
          <strong className={cx(styles.title, live && styles.titleLive)}>{trackerTitle(status)}</strong>
        </span>
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
          {today.tokensReported ? (
            <span className={styles.metric}>
              <span className={styles.stripValue}>
                {today.estimated ? "~" : ""}
                {formatTokens(today.tokens)}
              </span>
              <span className={styles.counterUnit}>tokens</span>
              <TokenCost estimate={todayCost} />
              {today.cachedTokens > 0 && <span className={styles.cached}>{formatTokens(today.cachedTokens)} cached</span>}
            </span>
          ) : (
            <span className={styles.counterUnit} title={TOKENS_NOT_REPORTED_TITLE}>{TOKENS_NOT_REPORTED}</span>
          )}
          <span className={styles.metric}>
            <span className={styles.stripValue}>{formatActiveTime(today.activeSeconds)}</span>
            <span className={styles.counterUnit}>today</span>
          </span>
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
 *   (● Connected)                          ← green only here (dot, word, its tint)
 *   last ping 12s ago · every 30s
 *   TODAY     1.2k tokens   34m active
 *   NOW       Online · in vibehub · Claude Code · Claude Fable 5.1 · for 12m
 *   MODELS    ✦ Claude Fable 5.1 · ⌘ Claude Code           160 today · 12s ago
 *   DEVICES   Windows · Sep 4 · seen 12s ago · Revoke   (settings; home only if > 1 *used*)
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
          {/* The badge's own silhouette, not a bare dot: the head is 26px of pill plus
              one meta line, and the skeleton has to be the same or the card grows
              under the reader the moment the status lands. */}
          <Skeleton variant="pill" width={118} height={26} />
          <Skeleton width={190} height={16} />
        </div>
        {/* Each section's first child stands in for the label and lands in the rail,
            by position — the same rule the real labels are placed by. */}
        <div className={styles.section}>
          <Skeleton width={38} height={12} />
          <Skeleton width={168} height={22} />
        </div>
        <div className={styles.section}>
          <Skeleton width={30} height={12} />
          <Skeleton width="55%" height={13} />
          <Skeleton width="40%" height={13} />
        </div>
        <div className={styles.section}>
          <Skeleton width={54} height={12} />
          {/* One `.rows` wrapper, exactly as the real list renders: as loose children
              of the grid each row would take a row-gap the real rows do not have, and
              five of those is a 40px jump. */}
          <div className={styles.rows}>
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
        </div>
        <div className={styles.section}>
          <Skeleton width={54} height={12} />
          <div className={styles.rows}>
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
  const heartbeat = status.lastSeenAt ? `updated ${agoShort(status.lastSeenAt, now)}` : "waiting for first update";
  const today = sumToday(status.sources);
  const todayCost = estimateTodayCost(status.sources, today.tokens);
  // "≈ $—" for an unknown model, never a made-up "≈ $0".
  const todayCostFormatted = presentTokenCost(todayCost).amount;

  // For compact models:
  // "compact models (top few + "Show all", hide zero rows)"
  const isZeroRow = (s: TrackerSource) => s.tokensToday === 0 && s.activeSecondsToday === 0;
  const nonZeroSources = status.sources.filter((s) => !isZeroRow(s));
  const hasZeroRows = nonZeroSources.length < status.sources.length;

  let sources: TrackerSource[];
  let canShowMore = false;

  if (variant === "home") {
    const capSources = !allSources && status.sources.length > HOME_SOURCE_ROWS;
    sources = capSources ? status.sources.slice(0, HOME_SOURCE_ROWS) : status.sources;
    canShowMore = status.sources.length > HOME_SOURCE_ROWS;
  } else {
    if (allSources) {
      sources = status.sources;
    } else {
      sources = (nonZeroSources.length > 0 ? nonZeroSources : status.sources).slice(0, 3);
    }
    canShowMore = status.sources.length > sources.length || hasZeroRows;
  }

  return (
    <Card className={cx(styles.panel, className)} data-live={live || undefined}>
      <div className={styles.head}>
        <div className={styles.headRow}>
          <span className={cx(styles.statusPill, variant === "settings" && styles.statusPillBig)}>
            <StatusDot status={status.presence.status} pulse={live} size={variant === "settings" ? 10 : 8} className={styles.headDot} />
            <strong className={cx(styles.title, variant === "settings" && styles.titleBig, live && styles.titleLive)}>{trackerTitle(status)}</strong>
          </span>
          <span className={styles.meta}>
            {variant === "settings" ? `${heartbeat} · ${everyLabel(status.heartbeatIntervalMs)}` : heartbeat}
          </span>
        </div>
        <StaleTrackerHint status={status} className={styles.headHint} />
      </div>

      <section className={styles.section} aria-label="Today">
        <span className={styles.label}>Today</span>
        {variant === "settings" ? (
          <div className={styles.bigNumbersRow}>
            <div className={styles.bigStatGroup}>
              <span className={styles.bigStatValue}>
                {today.tokensReported ? (
                  <>
                    {today.estimated ? "~" : ""}
                    {formatTokens(today.tokens)}
                  </>
                ) : (
                  <span className={styles.counterUnit} title={TOKENS_NOT_REPORTED_TITLE}>{TOKENS_NOT_REPORTED}</span>
                )}
              </span>
              <span className={styles.bigStatLabel}>
                tokens{today.cachedTokens > 0 && <span className={styles.cached}> · {formatTokens(today.cachedTokens)} cached</span>}
              </span>
            </div>
            <div className={styles.bigStatGroup}>
              <span className={styles.bigStatValue}>{todayCostFormatted}</span>
              <span className={styles.bigStatLabel}>cost</span>
            </div>
            <div className={styles.bigStatGroup}>
              <span className={styles.bigStatValue}>{formatActiveTime(today.activeSeconds)}</span>
              <span className={styles.bigStatLabel}>active</span>
            </div>
          </div>
        ) : (
          <span className={styles.counter}>
            {today.tokensReported ? (
              <span className={styles.metric}>
                <span className={styles.counterValue}>
                  {today.estimated ? "~" : ""}
                  {formatTokens(today.tokens)}
                </span>
                <span className={styles.counterUnit}>tokens</span>
                <TokenCost estimate={todayCost} />
                {today.cachedTokens > 0 && <span className={styles.cached}>{formatTokens(today.cachedTokens)} cached</span>}
              </span>
            ) : (
              <span className={styles.counterUnit} title={TOKENS_NOT_REPORTED_TITLE}>{TOKENS_NOT_REPORTED}</span>
            )}
            <span className={styles.metric}>
              <span className={styles.counterValue}>{formatActiveTime(today.activeSeconds)}</span>
              <span className={styles.counterUnit}>active</span>
            </span>
          </span>
        )}
      </section>

      <section className={styles.section} aria-label="Now">
        <span className={styles.label}>Now</span>
        {running ? (
          <PresenceBlock presence={status.presence} variant="row" />
        ) : (
          <span className={styles.dim}>
            {variant === "settings" ? "No recent activity" : "No recent supported AI activity"}
          </span>
        )}
      </section>

      <section className={styles.section} aria-label="Models">
        <span className={styles.label}>Models</span>
        {status.sources.length === 0 ? (
          <span className={styles.dim}>
            {variant === "settings" ? "No activity yet" : "No supported AI activity yet."}
          </span>
        ) : (
          <>
            <div className={cx(styles.rows, "stagger")}>
              {sources.map((s, i) => (
                <SourceRow key={`${s.tool}|${s.model ?? "no-model"}`} source={s} now={now} index={i} />
              ))}
            </div>
            {canShowMore && (
              <button type="button" className={styles.more} onClick={() => setAllSources((v) => !v)}>
                {variant === "home"
                  ? allSources ? "Show fewer" : `${status.sources.length - HOME_SOURCE_ROWS} more`
                  : allSources ? "Show fewer" : "Show all"}
              </button>
            )}
          </>
        )}
      </section>

      {showDevices && (
        <section className={styles.section} aria-label="Devices">
          {variant === "settings" ? (
            <details className={styles.devicesExpander}>
              <summary className={styles.devicesSummary}>
                <span className={styles.label}>Devices · {devices.length}</span>
                <Icon name="chevronDown" size={13} className={styles.devicesChevron} />
              </summary>
              <div className={styles.devicesBody}>
                <DeviceList devices={devices} now={now} onRevoke={onRevoke} />
                {onAddDevice && !addDeviceBlock && (
                  <div className={styles.addDeviceRow}>
                    <Button size="sm" variant="secondary" onClick={onAddDevice} loading={addingDevice}>
                      Add device
                    </Button>
                  </div>
                )}
                {addDeviceBlock}
              </div>
            </details>
          ) : (
            <>
              <span className={styles.label}>Devices</span>
              <DeviceList devices={devices} now={now} />
              {onAddDevice && !addDeviceBlock && (
                <div>
                  <Button size="sm" variant="secondary" onClick={onAddDevice} loading={addingDevice}>
                    Add device
                  </Button>
                </div>
              )}
              {addDeviceBlock}
            </>
          )}
        </section>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <footer className={styles.footer}>
        <div className={styles.privacy}>
          <p className={styles.privacyShort}>
            Usage activity only: code and prompts are not sent. Profiles and stats are public.
          </p>
          <details className={styles.privacyDetails}>
            <summary className={styles.privacySummary}>Details</summary>
            <p className={styles.privacyFull}>
              {TRACKER_LOCAL_READS} {TRACKER_UPLOADS} {TRACKER_VISIBILITY} {TRACKER_SUPPORT_NOTICE} {TRACKER_STATE_NOTICE} {TRACKER_HISTORY_NOTICE} Stop locally from Status, Stop &amp; reconnect. Revoke removes reporting authorization, not guaranteed local shutdown or history erasure.
            </p>
          </details>
        </div>
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
