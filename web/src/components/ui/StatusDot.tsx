import type { PresenceStatus } from "../../types";
import styles from "./StatusDot.module.css";

const COLOR_VAR: Record<PresenceStatus, string> = {
  active: "var(--vh-status-active)",
  idle: "var(--vh-status-idle)",
  offline: "var(--vh-status-offline)",
};

interface Props {
  status: PresenceStatus;
  label: string;
  /** Pulsing ring behind the dot — reserved for a viewer's own live status (Home YOU card),
   * where "active" has to read as unmistakable at a glance, not just a color/label change. */
  pulse?: boolean;
}

export function StatusDot({ status, label, pulse = false }: Props) {
  return (
    <span className={styles.wrap}>
      <span className={styles.dotWrap}>
        {pulse && <span className={styles.pulse} style={{ background: COLOR_VAR[status] }} aria-hidden="true" />}
        <span className={styles.dot} style={{ background: COLOR_VAR[status] }} />
      </span>
      {label}
    </span>
  );
}
