import type { ReactNode } from "react";
import type { PresenceStatus } from "../../types";
import styles from "./StatusDot.module.css";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

interface Props {
  status: PresenceStatus;
  /** Text next to the dot. Omit it and the dot stands alone (decorative, aria-hidden) —
   * PresenceBlock does that and prints its own "Online" word. */
  label?: ReactNode;
  /** Pulsing ring behind the dot, same color at low opacity — the live state at a
   * glance. Pair it with `active`; a pulsing idle/offline dot reads as a bug. */
  pulse?: boolean;
  size?: 8 | 10;
  className?: string;
}

/**
 * Presence dot. `active` paints `--vh-status-active`, which the theme maps to the
 * one deliberate hue in the product (`--vh-live`, green); idle/offline stay
 * grayscale. Color changes cross-fade over `--dur-state` (200ms, opacity/color only).
 */
export function StatusDot({ status, label, pulse = false, size = 8, className }: Props) {
  const standalone = label === undefined || label === null || label === false;
  const dot = (
    <span
      className={cx(styles.dotWrap, size === 10 && styles.s10, !standalone && styles.nudge, standalone && className)}
      aria-hidden="true"
    >
      {pulse && <span className={cx(styles.pulse, styles[status])} />}
      <span className={cx(styles.dot, styles[status])} />
    </span>
  );

  if (standalone) return dot;

  return (
    <span className={cx(styles.wrap, className)}>
      {dot}
      <span className={styles.label}>{label}</span>
    </span>
  );
}
