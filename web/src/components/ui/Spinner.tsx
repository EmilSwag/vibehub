import styles from "./Spinner.module.css";

interface SpinnerProps {
  /** Diameter in px. 14 suits a default button, 12 a `sm` one. */
  size?: number;
  className?: string;
}

/**
 * The one place a spinner is allowed (skills/emil_design_eng §5): inside a button,
 * for the duration of that button's own action. Content blocks get a shape-matched
 * `Skeleton` instead — never this. Paints in `currentColor`, so it inherits whatever
 * the button already is and needs no variant of its own.
 */
export function Spinner({ size = 14, className }: SpinnerProps) {
  return (
    <span
      aria-hidden="true"
      className={[styles.spinner, className].filter(Boolean).join(" ")}
      style={{ width: size, height: size, borderWidth: Math.max(1.5, size / 8) }}
    />
  );
}
