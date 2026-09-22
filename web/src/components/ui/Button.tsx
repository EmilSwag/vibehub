import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./Spinner";
import styles from "./Button.module.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** `sm` for inline row actions (Invite, Accept, Copy); `md` is the default. */
  size?: "sm" | "md";
  /**
   * This button's own action is in flight. Shows the inline spinner and blocks
   * re-entry. The label keeps its box and only turns invisible, so the button never
   * changes width mid-action (skills/emil_design_eng §5: no layout jump).
   */
  loading?: boolean;
}

/** Ref-forwarding so dialogs can place initial focus on a specific button. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, className, children, disabled, ...rest },
  ref,
) {
  const classes = [
    styles.btn,
    styles[variant],
    size === "sm" && styles.sm,
    loading && styles.loading,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className={styles.content}>{children}</span>
      {loading && (
        <span className={styles.spinnerSlot}>
          <Spinner size={size === "sm" ? 12 : 14} />
        </span>
      )}
    </button>
  );
});
