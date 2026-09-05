import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import type { LevelBreakdown } from "../../types";
import { formatTokens } from "../../lib/format";
import styles from "./LevelBadge.module.css";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** How the level band is expressed — on the *plate under the number*, never as a
 *  second circle. Round 6 drew a decorative tier ring at r=27 next to a progress
 *  arc at r=30.5, and two concentric circles of different completeness read as one
 *  broken ring (round-7 findings). One ring now means one thing: progress. */
export type LevelTier = "plain" | "faint" | "soft" | "ink" | "solid";

export function levelTierFor(level: number): LevelTier {
  if (level < 10) return "plain";
  if (level < 20) return "faint";
  if (level < 30) return "soft";
  if (level < 40) return "ink";
  return "solid";
}

/** Mirrors server/src/lib/level.ts: level = floor(sqrt(xp/10)) + 1. */
const xpFloor = (level: number) => (level - 1) ** 2 * 10;
const xpCeil = (level: number) => level ** 2 * 10;

/** How far into the current level the account sits, 0–1. */
function progressToNextLevel(level: number, xp: number): number {
  const floor = xpFloor(level);
  const ceil = xpCeil(level);
  if (ceil <= floor) return 1;
  return Math.min(1, Math.max(0, (xp - floor) / (ceil - floor)));
}

const RING_R = 28;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;
const PLATE_R = 20;

/** Below this the breakdown stops being a popover and becomes a bottom sheet.
 *  Matches the `.sheet` rules in the stylesheet. */
const SHEET_BREAKPOINT = 640;

interface Props {
  level: number;
  /** Full data enables the XP progress ring + (size="md") the breakdown popover.
   *  Omitted for badges on *other* people (friend rows, suggested list) — we only
   *  know their level, never their xp, so the ring stays an empty track rather
   *  than faking progress. */
  breakdown?: LevelBreakdown;
  /** `md` = profile header (default, interactive when breakdown is given); `sm` = inline in a list row (static). */
  size?: "md" | "sm";
  className?: string;
}

/**
 * One ring, one meaning: a faint track with the XP progress drawn over it in round
 * caps, the level number centred on a plate whose weight marks the band, and the
 * word "Level" under it.
 *
 * With a breakdown at size="md" the badge is a button that opens a real popover —
 * bordered, elevated, and on desktop anchored *beside* the badge so it opens into
 * the page instead of over the stats grid below. On phones the same content is a
 * bottom sheet. Escape and a click outside both close it and hand focus back.
 */
export function LevelBadge({ level, breakdown, size = "md", className }: Props) {
  const [open, setOpen] = useState(false);
  // Decided at click time: below SHEET_BREAKPOINT the panel is portalled to <body>
  // as a bottom sheet, because every page sits inside a wrapper that keeps a
  // transform after its reveal animation — and a transformed ancestor becomes the
  // containing block for position: fixed, which would trap the sheet inside the
  // page column instead of pinning it to the viewport.
  const [sheet, setSheet] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const tier = levelTierFor(level);
  const pct = breakdown ? progressToNextLevel(level, breakdown.xp) : null;
  const interactive = size === "md" && !!breakdown;

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();

    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
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

  const toNext = breakdown ? Math.max(0, xpCeil(level) - breakdown.xp) : 0;

  const ring = (
    <svg className={styles[`ring-${size}`]} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle className={styles.track} cx={32} cy={32} r={RING_R} fill="none" strokeWidth={tier === "solid" ? 3.5 : 2.5} />
      {pct !== null && pct > 0 && (
        <circle
          className={styles.arc}
          cx={32}
          cy={32}
          r={RING_R}
          fill="none"
          stroke="currentColor"
          strokeWidth={tier === "solid" ? 3.5 : 2.5}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - pct)}
          transform="rotate(-90 32 32)"
        />
      )}
      {tier !== "plain" && <circle className={styles[`plate-${tier}`]} cx={32} cy={32} r={PLATE_R} />}
      <text
        className={cx(styles.number, (tier === "ink" || tier === "solid") && styles.numberOnPlate)}
        x={32}
        y={39.5}
        textAnchor="middle"
        fontFamily="var(--vh-font-mono)"
        fontWeight={600}
        fontSize={22}
      >
        {level}
      </text>
    </svg>
  );

  if (!interactive) {
    return (
      <div className={cx(styles[`wrap-${size}`], className)} role="img" aria-label={`Level ${level}`}>
        {size === "md" ? (
          <span className={styles.static}>
            {ring}
            <span className={styles.caption}>Level</span>
          </span>
        ) : (
          ring
        )}
      </div>
    );
  }

  const panel = (
    <div
      className={cx(styles.panel, sheet && styles.sheet, "scale-in")}
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Level breakdown"
    >
      <span className={styles.grip} aria-hidden="true" />

      <div className={styles.next}>
        <span className={styles.nextLabel}>
          {toNext > 0 ? `${toNext} XP to level ${level + 1}` : `Level ${level} complete`}
        </span>
        <span className={styles.bar} aria-hidden="true">
          <span className={styles.barFill} style={{ "--pct": pct ?? 0 } as CSSProperties} />
        </span>
      </div>

      {rows.map(([label, value]) => (
        <div className={styles.row} key={label}>
          <span className={styles.rowLabel}>{label}</span>
          <span className={styles.rowValue}>{value}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className={cx(styles[`wrap-${size}`], className)} ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className={cx(styles.trigger, open && styles.triggerOpen)}
        onClick={() => {
          setSheet(window.matchMedia(`(max-width: ${SHEET_BREAKPOINT}px)`).matches);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Level ${level} — show breakdown`}
      >
        {ring}
        <span className={styles.caption}>Level</span>
      </button>

      {open &&
        (sheet
          ? createPortal(
              <>
                <div className={styles.scrim} onClick={close} aria-hidden="true" />
                {panel}
              </>,
              document.body
            )
          : panel)}
    </div>
  );
}
