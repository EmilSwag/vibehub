import type { HTMLAttributes } from "react";
import styles from "./Badge.module.css";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  active?: boolean;
}

export function Badge({ active, className, ...rest }: BadgeProps) {
  const classes = [styles.badge, active && styles.active, className].filter(Boolean).join(" ");
  return <span className={classes} {...rest} />;
}
