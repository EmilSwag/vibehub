import { useNavigate } from "react-router-dom";
import type { Toast } from "../../context/RealtimeContext";
import styles from "./Toast.module.css";

interface Props {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

/**
 * Global notification stack (bottom-right). Newest at the bottom, max 4.
 * Clicking a toast follows its `href` if present; the × always dismisses.
 */
export function ToastStack({ toasts, onDismiss }: Props) {
  const navigate = useNavigate();
  if (toasts.length === 0) return null;

  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[styles.toast, t.href && styles.clickable].filter(Boolean).join(" ")}
          onClick={() => {
            if (!t.href) return;
            onDismiss(t.id);
            navigate(t.href);
          }}
        >
          <span className={styles.dot} aria-hidden="true" />
          <div className={styles.text}>
            <strong className={styles.title}>{t.title}</strong>
            {t.body && <span className={styles.body}>{t.body}</span>}
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(t.id);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
