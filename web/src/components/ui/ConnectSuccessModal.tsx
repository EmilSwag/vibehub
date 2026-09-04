import { useEffect } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import styles from "./ConnectSuccessModal.module.css";

interface Props {
  open: boolean;
  /** "project · Tool · 12m", or "Waiting for the first heartbeat." while no activity has landed yet. */
  body: string;
  onClose: () => void;
}

/** One-time celebration on first heartbeat / already-connected landing (ConnectTools). */
export function ConnectSuccessModal({ open, body, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-success-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className={styles.check} aria-hidden="true">
          <Icon name="check" size={20} />
        </span>
        <h2 id="connect-success-title" className={styles.title}>
          Connected.
        </h2>
        <p className={styles.body}>{body}</p>
        <Button onClick={onClose} className={styles.action}>
          Got it
        </Button>
      </div>
    </div>
  );
}
