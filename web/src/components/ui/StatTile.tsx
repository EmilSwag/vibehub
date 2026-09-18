import type { ReactNode } from "react";
import { Skeleton } from "./Skeleton";
import styles from "./StatTile.module.css";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

interface Props {
  label: string;
  /** Omit while `loading`. */
  value?: string;
  /** `number` (default): mono, tabular digits, one line. `text`: a name that must
   * read whole — "Claude Sonnet 4.5", never "Claude Son…" — so it is set in the
   * UI sans one size down and wraps instead of truncating. `tool`: same sans
   * sizing, but the icon+name are one unbreakable inline group — the name
   * ellipsizes instead of wrapping, because this is the one tile that also
   * carries a companion ("NN% of time") that must be free to wrap onto its own
   * line without the name fighting it for space. */
  kind?: "number" | "text" | "tool";
  /** Same box, same label, a value-shaped bar — nothing moves when data lands. */
  loading?: boolean;
  /** Drops the value to secondary ink. For the gauge that must not read as a
   * score — tokens are fuel, not rank (DESIGN.md). */
  quiet?: boolean;
  /** Quiet inline text only, never a nested control when the tile is a button. */
  companion?: ReactNode;
  /** A mark set before the value — the model's own, on the Top model tile. Sized to
   * the value's cap height by the caller; it inherits the value's colour. */
  mark?: ReactNode;
  /** Makes the tile a button. The tile keeps its exact box either way, so a row of
   * tiles does not jump when one of them becomes clickable. */
  onClick?: () => void;
  /** What the click does, for anyone who cannot see where it goes. */
  actionLabel?: string;
}

/** One number (or name) over a small uppercase label. Sits inside a Card as a
 * tinted well, not a nested card — one border per block (house rule). */
export function StatTile({
  label,
  value,
  kind = "number",
  loading = false,
  quiet = false,
  companion,
  mark,
  onClick,
  actionLabel,
}: Props) {
  // "Top model" and "Top tool" share the same sans sizing (`.text`); only their
  // wrap behaviour differs below, so the skeleton's own sizing is shared too.
  const textLike = kind !== "number";

  const body = (
    <>
      {loading ? (
        <span className={cx(styles.value, textLike && styles.text, !!companion && styles.withCompanion)}>
          <Skeleton
            className={styles.valueSkeleton}
            width={textLike ? "72%" : "48%"}
            height={textLike ? 14 : 20}
          />
          {companion && <span className={styles.companion}><Skeleton width={76} height={12} /></span>}
        </span>
      ) : kind === "tool" ? (
        <span className={cx(styles.value, styles.text, quiet && styles.quiet, !!companion && styles.withCompanion)}>
          {/* One unbreakable unit: the glyph never shrinks (`.mark`, unchanged)
              and the name ellipsizes instead of wrapping — only the companion
              below is free to wrap, never the icon+name pair itself. */}
          <span className={styles.toolGroup}>
            {mark && (
              <span className={styles.mark} aria-hidden="true">
                {mark}
              </span>
            )}
            <span className={styles.toolName}>{value}</span>
          </span>
          {companion && <span className={cx(styles.companion, styles.toolCompanion)}>{companion}</span>}
        </span>
      ) : (
        <span className={cx(styles.value, kind === "text" && styles.text, quiet && styles.quiet, !!companion && styles.withCompanion)}>
          {mark && (
            <span className={styles.mark} aria-hidden="true">
              {mark}
            </span>
          )}
          {companion ? <span>{value}</span> : value}
          {companion && <span className={styles.companion}>{companion}</span>}
        </span>
      )}
      <span className={styles.label}>{label}</span>
    </>
  );

  if (onClick && !loading) {
    return (
      <button
        type="button"
        className={cx(styles.tile, styles.action)}
        onClick={onClick}
        aria-label={actionLabel}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={styles.tile} aria-busy={loading || undefined}>
      {body}
    </div>
  );
}
