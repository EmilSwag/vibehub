import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { LevelBreakdown } from "../../types";
import { formatTokens } from "../../lib/format";
import { Icon } from "./Icon";
import styles from "./LevelBadge.module.css";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** Mirrors server/src/lib/level.ts: level = floor(sqrt(xp/10)) + 1 — inverted here
 *  to find how far into the current level the account's xp sits. */
function progressToNextLevel(level: number, xp: number): number {
  const floor = (level - 1) ** 2 * 10;
  const ceil = level ** 2 * 10;
  if (ceil <= floor) return 1;
  return Math.min(1, Math.max(0, (xp - floor) / (ceil - floor)));
}

/**
 * Steam-style level plate for the profile hero: big number, a thin bar showing
 * progress into the next level, and a click-to-expand breakdown of what earned it.
 */
export function LevelBadge({ breakdown }: { breakdown: LevelBreakdown }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const pct = progressToNextLevel(breakdown.level, breakdown.xp);

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

  const rows: [string, string][] = [
    ["XP", String(breakdown.xp)],
    ["Active", `${breakdown.activeHours}h`],
    ["Tokens", formatTokens(breakdown.totalTokens)],
    ["Projects", String(breakdown.projects)],
    ["Friends", String(breakdown.friends)],
    ["Commits", String(breakdown.commits)],
  ];

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={cx(styles.plate, open && styles.plateOpen)}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Level ${breakdown.level} — show breakdown`}
      >
        <span className={styles.num}>{breakdown.level}</span>
        <span className={styles.label}>
          Level
          <Icon name="chevronDown" size={10} className={cx(styles.chev, open && styles.chevOpen)} />
        </span>
        <span className={styles.barTrack}>
          <span className={styles.barFill} style={{ "--pct": pct } as CSSProperties} />
        </span>
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
