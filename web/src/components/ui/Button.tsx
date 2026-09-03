import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** `sm` for inline row actions (Invite, Accept, Copy); `md` is the default. */
  size?: "sm" | "md";
}

export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonProps) {
  const classes = [styles.btn, styles[variant], size === "sm" && styles.sm, className]
    .filter(Boolean)
    .join(" ");
  return <button className={classes} {...rest} />;
}
