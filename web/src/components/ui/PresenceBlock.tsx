import { useEffect, useState } from "react";
import type { Activity, PresenceStatus } from "../../types";
import { modelFamily, presenceParts, presenceStatusLabel, toolFamily } from "../../lib/format";
import { ModelGlyph } from "./ModelGlyph";
import { StatusDot } from "./StatusDot";
import { ToolGlyph } from "./ToolGlyph";
import styles from "./PresenceBlock.module.css";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

/** What PresenceBlock needs — `Presence` (WS/REST) and `TrackerStatus.presence` both fit. */
export interface PresenceLike {
  status: PresenceStatus;
  activity: Activity | null;
}

export type PresenceVariant = "row" | "hero" | "compact";

export interface PresenceBlockProps {
  /** Missing/null renders as offline. */
  presence?: PresenceLike | null;
  /** "row" (friend lists, cards), "hero" (profile header, one size up), "compact"
   * (one ellipsized line for menus and top bars). */
  variant?: PresenceVariant;
  /** Line 4 "for 1h 42m" — active only. Default true. */
  showElapsed?: boolean;
  /** Fixed instant for elapsed (tests, snapshots). Omit to tick every 30s. */
  now?: number;
  className?: string;
}

/**
 * Wall-clock that re-renders on an interval while `enabled`. Cleans up on unmount
 * or when disabled; returns a frozen value otherwise.
 */
export function useNow(enabled: boolean, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs]);
  return now;
}

/**
 * The one way a person's presence is rendered.
 *
 *   ● Online                       ← --vh-live, the product's single deliberate hue
 *   in vibehub                     ← project, --vh-text
 *   ⌘ Claude Code · ✦ Claude Fable 5.1   ← tool · model, --vh-text-dim
 *   for 1h 42m                     ← active only, --vh-text-faint, tabular digits
 *
 * Idle keeps lines 1–3 in gray; offline is the word alone. Status changes cross-fade
 * (opacity/color only, 200ms, off under prefers-reduced-motion).
 */
export function PresenceBlock({ presence, variant = "row", showElapsed = true, now, className }: PresenceBlockProps) {
  const status: PresenceStatus = presence?.status ?? "offline";
  const activity = status === "offline" ? null : presence?.activity ?? null;
  const showFor = status === "active" && showElapsed && activity !== null;
  const tick = useNow(showFor && now === undefined);
  const parts = activity ? presenceParts(activity, now ?? tick) : null;
  const word = presenceStatusLabel(status);
  const pulse = status === "active";

  if (variant === "compact") {
    const tail = parts ? [parts.project, parts.tool, parts.model, showFor ? parts.elapsed : null].filter(Boolean).join(" · ") : "";
    return (
      <span className={cx(styles.compact, styles[status], className)} data-status={status}>
        <StatusDot status={status} pulse={pulse} size={8} />
        <span className={styles.compactText}>
          <span key={status} className={styles.word}>
            {word}
          </span>
          {tail && ` · ${tail}`}
        </span>
      </span>
    );
  }

  const glyph = variant === "hero" ? 15 : 14;

  return (
    <div className={cx(styles.block, styles[variant], styles[status], className)} data-status={status}>
      <span key={status} className={styles.statusLine}>
        <StatusDot status={status} pulse={pulse} size={variant === "hero" ? 10 : 8} />
        <span className={styles.word}>{word}</span>
      </span>

      {activity && parts && (
        <span key={`${status}-details`} className={styles.details}>
          <span className={styles.project}>
            <span className={styles.in}>in</span>
            <span className={styles.projectName}>{parts.project}</span>
          </span>

          <span className={styles.tools}>
            <ToolGlyph family={toolFamily(activity.tool)} size={glyph} className={styles.glyph} />
            <span className={styles.name}>{parts.tool}</span>
            {parts.model && (
              <>
                <span className={styles.sep} aria-hidden="true">
                  ·
                </span>
                <ModelGlyph family={modelFamily(activity.model)} size={glyph} className={styles.glyph} />
                <span className={styles.name}>{parts.model}</span>
              </>
            )}
          </span>

          {showFor && (
            <span className={styles.elapsed}>{parts.elapsed === "just now" ? "just now" : `for ${parts.elapsed}`}</span>
          )}
        </span>
      )}
    </div>
  );
}
