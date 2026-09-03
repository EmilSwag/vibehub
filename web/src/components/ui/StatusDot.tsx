import type { PresenceStatus } from "../../types";
import styles from "./StatusDot.module.css";

const COLOR_VAR: Record<PresenceStatus, string> = {
  active: "var(--vh-status-active)",
  idle: "var(--vh-status-idle)",
  offline: "var(--vh-status-offline)",
};

export function StatusDot({ status, label }: { status: PresenceStatus; label: string }) {
  return (
    <span className={styles.wrap}>
      <span className={styles.dot} style={{ background: COLOR_VAR[status] }} />
      {label}
    </span>
  );
}
