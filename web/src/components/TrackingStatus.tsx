import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { TrackerDevice, TrackerSource, TrackerStatus as TrackerStatusData } from "../types";
import { formatTokens, humanizeModel, toolFamily, toolLabel } from "../lib/format";
import { stagger } from "../lib/motion";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { PresenceBlock, useNow } from "./ui/PresenceBlock";
import { Skeleton } from "./ui/Skeleton";
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

/* ---- Devices (shared with the not-connected card in ConnectTools) ---- */

interface DeviceListProps {
  devices: TrackerDevice[];
  now: number;
  onRevoke?: (id: string) => Promise<void> | void;
}

/** label · "seen 3m ago" / "never used" · Revoke. One row per non-revoked token. */
export function DeviceList({ devices, now, onRevoke }: DeviceListProps) {
  const [busy, setBusy] = useState<string | null>(null);

  const revoke = async (id: string) => {
    if (!onRevoke) return;
    setBusy(id);
    try {
      await onRevoke(id);
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
            <Button size="sm" variant="ghost" onClick={() => revoke(d.id)} disabled={busy === d.id}>
              Revoke
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---- Sources ---- */

function SourceRow({ source, now, index }: { source: TrackerSource; now: number; index: number }) {
  const model = humanizeModel(source.model);
  return (
    <div className={cx(styles.row, styles.rowSource)} style={stagger(index)}>
      <span className={styles.rowMain}>
        <ToolGlyph family={toolFamily(source.tool)} size={14} className={styles.rowGlyph} />
        <span className={styles.rowTool}>{toolLabel(source.tool)}</span>
        {model && (
          <>
            <span className={styles.sep} aria-hidden="true">
              ·
            </span>
            <span className={styles.rowModel}>{model}</span>
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

/* ---- Panel ---- */

export interface TrackingStatusProps {
  /** home = first-time explainer on the Home page (Got it + settings link);
   * settings = the permanent panel in Settings › Tracker (always lists devices). */
  variant: "home" | "settings";
  /** null renders the shape-matched skeleton. */
  status: TrackerStatusData | null;
  /** Home only — "Got it". */
  onDismiss?: () => void;
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
 * "What got connected, and is it tracking?" — the connected half of ConnectTools.
 *
 *   ● Tracking works                       ← green only here (dot + title)
 *     last heartbeat 12s ago · every 30s
 *   Now            Online · in vibehub · Claude Code · Claude Fable 5.1 · for 12m
 *   Seen this week ⌘ Claude Code · Claude Fable 5.1          160 today · 12s ago
 *   Devices        Windows · Sep 4 · seen 12s ago · Revoke   (settings; home only if > 1)
 *   Leaves your machine: … Never code, prompts or diffs.     [Got it]
 *
 * Relative times re-render every 5s. The wrapper owns polling and realtime.
 */
export function TrackingStatus({
  variant,
  status,
  onDismiss,
  onRevoke,
  onAddDevice,
  addingDevice = false,
  addDeviceBlock,
  settingsHref,
  error,
  className,
}: TrackingStatusProps) {
  const now = useNow(status !== null, 5000);

  if (!status) {
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
          <Skeleton width={30} height={12} />
          <Skeleton width="55%" height={13} />
        </div>
        <div className={styles.section}>
          <Skeleton width={92} height={12} />
          {[0, 1].map((i) => (
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
      </Card>
    );
  }

  const live = status.presence.status === "active";
  const running = status.presence.status !== "offline" && status.presence.activity !== null;
  const showDevices = variant === "settings" || status.devices.length > 1;
  const heartbeat = status.lastSeenAt ? `last heartbeat ${agoShort(status.lastSeenAt, now)}` : "no heartbeat yet";

  return (
    <Card className={cx(styles.panel, className)} data-live={live || undefined}>
      <div className={styles.head}>
        <StatusDot status={status.presence.status} pulse={live} size={10} className={styles.headDot} />
        <div className={styles.headText}>
          <strong className={cx(styles.title, live && styles.titleLive)}>
            {live ? "Tracking works" : "Connected — waiting for activity"}
          </strong>
          <span className={styles.meta}>
            {heartbeat} · {everyLabel(status.heartbeatIntervalMs)}
          </span>
        </div>
      </div>

      <section className={styles.section} aria-label="Now">
        <span className={styles.label}>Now</span>
        {running ? (
          <PresenceBlock presence={status.presence} variant="row" />
        ) : (
          <span className={styles.dim}>Nothing running right now</span>
        )}
      </section>

      <section className={styles.section} aria-label="Seen this week">
        <span className={styles.label}>Seen this week</span>
        {status.sources.length === 0 ? (
          <span className={styles.dim}>No activity yet — open your AI tool and start working.</span>
        ) : (
          <div className={cx(styles.rows, "stagger")}>
            {status.sources.map((s, i) => (
              <SourceRow key={`${s.tool}|${s.model ?? ""}`} source={s} now={now} index={i} />
            ))}
          </div>
        )}
      </section>

      {showDevices && (
        <section className={styles.section} aria-label="Devices">
          <span className={styles.label}>Devices</span>
          <DeviceList devices={status.devices} now={now} onRevoke={onRevoke} />
          {onAddDevice && !addDeviceBlock && (
            <div>
              <Button size="sm" variant="secondary" onClick={onAddDevice} disabled={addingDevice}>
                {addingDevice ? "Creating…" : "Add another device"}
              </Button>
            </div>
          )}
          {addDeviceBlock}
        </section>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <footer className={styles.footer}>
        <p className={styles.privacy}>
          Leaves your machine: tool, model, project name, timestamps, token counts. Never code, prompts or diffs.
        </p>
        {(onDismiss || settingsHref) && (
          <div className={styles.actions}>
            {settingsHref && (
              <Link to={settingsHref} className={styles.link}>
                Tracker settings
              </Link>
            )}
            {onDismiss && (
              <Button onClick={onDismiss} className={styles.primary}>
                Got it
              </Button>
            )}
          </div>
        )}
      </footer>
    </Card>
  );
}
