import { useEffect, useRef, useState } from "react";
import type { LevelBreakdown } from "../../types";
import { formatTokens } from "../../lib/format";
import styles from "./LevelBadge.module.css";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export type RingTier = "single" | "double" | "dashed" | "thick" | "ticks";

/** Steam-style level bands — the *shape* of the ring marks the tier, never a color
 *  (strict monochrome). Kept next to the component that reads it (design QA round 5). */
export function ringTierFor(level: number): RingTier {
  if (level < 10) return "single";
  if (level < 20) return "double";
  if (level < 30) return "dashed";
  if (level < 40) return "thick";
  return "ticks";
}

/** Mirrors server/src/lib/level.ts: level = floor(sqrt(xp/10)) + 1 — inverted here
 *  to find how far into the current level the account's xp sits. */
function progressToNextLevel(level: number, xp: number): number {
  const floor = (level - 1) ** 2 * 10;
  const ceil = level ** 2 * 10;
  if (ceil <= floor) return 1;
  return Math.min(1, Math.max(0, (xp - floor) / (ceil - floor)));
}

// Four 45°-corner tick marks (r 27→32), precomputed — static geometry, not worth
// recomputing with trig on every render.
const TICKS = [
  { x1: 51.09, y1: 51.09, x2: 54.63, y2: 54.63 },
  { x1: 12.91, y1: 51.09, x2: 9.37, y2: 54.63 },
  { x1: 12.91, y1: 12.91, x2: 9.37, y2: 9.37 },
  { x1: 51.09, y1: 12.91, x2: 54.63, y2: 9.37 },
];

function Ring({ tier }: { tier: RingTier }) {
  switch (tier) {
    case "single":
      return <circle cx={32} cy={32} r={27} fill="none" stroke="currentColor" strokeWidth={2} />;
    case "double":
      return (
        <>
          <circle cx={32} cy={32} r={27} fill="none" stroke="currentColor" strokeWidth={1.4} />
          <circle cx={32} cy={32} r={22.5} fill="none" stroke="currentColor" strokeWidth={1.4} />
        </>
      );
    case "dashed":
      return (
        <circle
          cx={32}
          cy={32}
          r={27}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeDasharray="3 2.6"
        />
      );
    case "thick":
      return (
        <>
          <circle cx={32} cy={32} r={25.5} fill="none" stroke="currentColor" strokeWidth={4} />
          <circle cx={32} cy={32} r={18.5} fill="none" stroke="currentColor" strokeWidth={0.75} />
        </>
      );
    case "ticks":
      return (
        <>
          <circle cx={32} cy={32} r={27} fill="none" stroke="currentColor" strokeWidth={2} />
          {TICKS.map((t, i) => (
            <line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            />
          ))}
        </>
      );
  }
}

const ARC_R = 30.5;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_R;

interface Props {
  level: number;
  /** Full data enables the XP progress arc + (size="md") the click-to-expand panel.
   *  Omitted for badges on *other* people (friend rows, suggested list) — we only
   *  know their level, never their xp, so no arc is drawn rather than faking one. */
  breakdown?: LevelBreakdown;
  /** `md` = profile header (default, interactive when breakdown is given); `sm` = inline in a list row (static). */
  size?: "md" | "sm";
  className?: string;
}

/**
 * Steam-style level badge: a monochrome ring whose *style* (not color) marks the
 * level band (see `ringTierFor`), an XP-progress arc drawn on top when the full
 * breakdown is known, and — size="md" with a breakdown — a click-to-expand panel.
 */
export function LevelBadge({ level, breakdown, size = "md", className }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const tier = ringTierFor(level);
  const pct = breakdown ? progressToNextLevel(level, breakdown.xp) : null;
  const interactive = size === "md" && !!breakdown;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const rows: [string, string][] = breakdown
    ? [
        ["XP", String(breakdown.xp)],
        ["Active", `${breakdown.activeHours}h`],
        ["Tokens", formatTokens(breakdown.totalTokens)],
        ["Projects", String(breakdown.projects)],
        ["Friends", String(breakdown.friends)],
        ["Commits", String(breakdown.commits)],
      ]
    : [];

  const ring = (
    <svg className={styles[`ring-${size}`]} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <Ring tier={tier} />
      {pct !== null && (
        <circle
          className={styles.arc}
          cx={32}
          cy={32}
          r={ARC_R}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeDasharray={ARC_CIRCUMFERENCE}
          strokeDashoffset={ARC_CIRCUMFERENCE * (1 - pct)}
          transform="rotate(-90 32 32)"
        />
      )}
      <text
        x={32}
        y={38}
        textAnchor="middle"
        fill="currentColor"
        fontFamily="var(--vh-font-mono)"
        fontWeight={600}
        fontSize={24}
      >
        {level}
      </text>
    </svg>
  );

  if (!interactive) {
    return (
      <div className={cx(styles[`wrap-${size}`], className)} role="img" aria-label={`Level ${level}`}>
        {ring}
        {size === "md" && <span className={styles.caption}>Lvl</span>}
      </div>
    );
  }

  return (
    <div className={cx(styles[`wrap-${size}`], className)} ref={ref}>
      <button
        type="button"
        className={cx(styles.trigger, open && styles.triggerOpen)}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Level ${level} — show breakdown`}
      >
        {ring}
        <span className={styles.caption}>Lvl</span>
      </button>

      {open && (
        <div className={cx(styles.panel, "scale-in")} role="dialog" aria-label="Level breakdown">
          {rows.map(([label, value]) => (
            <div className={styles.row} key={label}>
              <span className={styles.rowLabel}>{label}</span>
              <span className={styles.rowValue}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
