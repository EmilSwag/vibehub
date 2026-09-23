import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AchievementId } from "../../lib/achievements";
import { BadgeIcon } from "../achievements/BadgeIcon";
import { Confetti } from "./Confetti";
import { Icon } from "./Icon";
import styles from "./SkewToast.module.css";

export interface ToastData {
  id: string;
  category?: string;
  title: string;
  subtitle?: string;
  badgeId?: AchievementId;
  icon?: ReactNode;
  duration?: number;
  fireworks?: boolean;
}

export function showSkewToast(toast: Omit<ToastData, "id"> & { id?: string }) {
  const fullToast: ToastData = {
    ...toast,
    id: toast.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("vh-show-toast", { detail: fullToast }));
  }
}

export function triggerFireworks() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("vh-fireworks"));
  }
}

export function SkewToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());
  const [fireworksSeq, setFireworksSeq] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ToastData>).detail;
      if (!detail) return;
      // showSkewToast always sets an id; a raw dispatch might not, and the id is the
      // list key and the dismiss handle — never let one through without it.
      const toast: ToastData = {
        ...detail,
        id: detail.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      };
      setToasts((prev) => [toast, ...prev.slice(0, 2)]);

      const isUnlock =
        toast.fireworks ??
        (toast.category?.toLowerCase().includes("unlocked") ||
         toast.category?.toLowerCase().includes("community") ||
         Boolean(toast.badgeId));

      if (isUnlock) {
        setFireworksSeq((s) => s + 1);
      }

      const dur = toast.duration ?? 10000;
      setTimeout(() => {
        dismissToast(toast.id);
      }, dur);
    };

    const fwHandler = () => {
      setFireworksSeq((s) => s + 1);
    };

    window.addEventListener("vh-show-toast", handler);
    window.addEventListener("vh-fireworks", fwHandler);
    return () => {
      window.removeEventListener("vh-show-toast", handler);
      window.removeEventListener("vh-fireworks", fwHandler);
    };
  }, []);

  const dismissToast = (id: string) => {
    setLeavingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      setLeavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 280);
  };

  return (
    <>
      {fireworksSeq > 0 && typeof document !== "undefined" && createPortal(
        <div
          key={fireworksSeq}
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            width: "100vw",
            height: "100vh",
            pointerEvents: "none",
            zIndex: 99990,
          }}
        >
          <Confetti durationMs={5400} bursts={8} />
        </div>,
        document.body
      )}

      {toasts.length > 0 && (
        <div className={styles.portalContainer} aria-live="polite" role="status">
          {toasts.map((toast) => {
            const isLeaving = leavingIds.has(toast.id);
            return (
              <div
                key={toast.id}
                className={[styles.toastWrapper, isLeaving ? styles.toastLeaving : ""].join(" ")}
                onClick={() => dismissToast(toast.id)}
                role="alert"
              >
                <div className={styles.shimmerBar} aria-hidden="true" />

                <div className={styles.inner}>
                  <div className={styles.badgeSlot}>
                    {toast.badgeId ? (
                      <BadgeIcon id={toast.badgeId} size={28} unlocked />
                    ) : toast.icon ? (
                      toast.icon
                    ) : (
                      <Icon name="sparkles" size={24} />
                    )}
                  </div>

                  <div className={styles.body}>
                    <span className={styles.categoryTag}>
                      {toast.category ?? "Achievement Unlocked"}
                    </span>
                    <h4 className={styles.title}>{toast.title}</h4>
                    {toast.subtitle && <p className={styles.subtitle}>{toast.subtitle}</p>}
                  </div>

                  <button
                    type="button"
                    className={styles.closeBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissToast(toast.id);
                    }}
                    aria-label="Close notification"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

