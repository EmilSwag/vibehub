import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "../../lib/motion";
import { Button } from "./Button";
import styles from "./ConfirmDialog.module.css";

const EXIT_MS = 200;
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface ConfirmDialogProps {
  open: boolean;
  /** The question, as a statement. "Delete this post?" — not "Are you sure?". */
  title: string;
  /** One sentence on what actually happens. Omit when the title already says it. */
  body?: ReactNode;
  /** The verb, not "OK": "Delete", "Revoke". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Awaited — the confirm button stays pending until it settles. */
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

/**
 * The in-design replacement for `window.confirm` (skills/emil_design_eng §2, §3): a
 * native OS dialog is the one piece of chrome the product cannot style, and it drags
 * system blue into a strictly monochrome UI.
 *
 * Follows the same modal contract as ConnectSheet — portal, scrim, scroll lock, focus
 * trapped inside and returned to the opener on close. Focus lands on Cancel, not on the
 * destructive action, so a stray Enter does nothing.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const { render, closing } = useExitTransition(open, EXIT_MS);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelButton.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      const active = document.activeElement;
      if (!active || active === document.body || dialog.current?.contains(active)) opener.current?.focus();
    };
  }, [open]);

  // A dialog that reopens after a failed confirm must not come back still pending.
  useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  const close = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.getClientRects().length > 0,
      );
      if (!focusable.length) {
        event.preventDefault();
        dialog.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && active !== dialog.current && dialog.current?.contains(active);
      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [close],
  );

  if (!render) return null;

  return createPortal(
    <>
      <div className={cx(styles.scrim, closing && styles.scrimOut)} onClick={close} aria-hidden="true" />
      <div className={styles.wrap}>
        <div
          ref={dialog}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          aria-describedby={body ? `${id}-body` : undefined}
          tabIndex={-1}
          className={cx(styles.dialog, closing ? styles.dialogOut : styles.dialogIn)}
          onKeyDown={onKeyDown}
        >
          <h2 id={`${id}-title`} className={styles.title}>
            {title}
          </h2>
          {body && (
            <p id={`${id}-body`} className={styles.body}>
              {body}
            </p>
          )}
          <div className={styles.actions}>
            <Button ref={cancelButton} variant="secondary" onClick={close} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button variant="danger" onClick={confirm} loading={busy}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
