import { Skeleton } from "./Skeleton";
import styles from "./StatTile.module.css";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

interface Props {
  label: string;
  /** Omit while `loading`. */
  value?: string;
  /** `number` (default): mono, tabular digits, one line. `text`: a name that must
   * read whole — "Claude Sonnet 4.5", never "Claude Son…" — so it is set in the
   * UI sans one size down and wraps instead of truncating. */
  kind?: "number" | "text";
  /** Same box, same label, a value-shaped bar — nothing moves when data lands. */
  loading?: boolean;
  /** Drops the value to secondary ink. For the gauge that must not read as a
   * score — tokens are fuel, not rank (DESIGN.md). */
  quiet?: boolean;
}

/** One number (or name) over a small uppercase label. Sits inside a Card as a
 * tinted well, not a nested card — one border per block (house rule). */
export function StatTile({ label, value, kind = "number", loading = false, quiet = false }: Props) {
  return (
    <div className={styles.tile} aria-busy={loading || undefined}>
      {loading ? (
        <span className={cx(styles.value, kind === "text" && styles.text)}>
          <Skeleton className={styles.valueSkeleton} width={kind === "text" ? "72%" : "48%"} height={kind === "text" ? 14 : 20} />
        </span>
      ) : (
        <span className={cx(styles.value, kind === "text" && styles.text, quiet && styles.quiet)}>{value}</span>
      )}
      <span className={styles.label}>{label}</span>
    </div>
  );
}
