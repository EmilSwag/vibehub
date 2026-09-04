import type { ButtonHTMLAttributes } from "react";
import { useTheme } from "../../lib/theme";
import styles from "./ThemeToggle.module.css";

/**
 * Icon-only light/dark switch (36px hit area) for the top bar. Shows the
 * theme that is on screen — sun in light, moon in dark — and flips it on
 * click (from "system" it becomes an explicit choice, see lib/theme.ts).
 * The 3-way System/Light/Dark control lives in Settings › Appearance.
 *
 * Icons follow ui/Icon.tsx: 24 grid, 1.75 stroke, round caps, currentColor.
 * They are drawn here rather than added to Icon's `name` union because they
 * crossfade as a stacked pair, which Icon's single-glyph API does not model.
 */
type ThemeToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type" | "children">;

export function ThemeToggle({ className, ...rest }: ThemeToggleProps) {
  const { resolved, toggle } = useTheme();
  const dark = resolved === "dark";
  const label = dark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      className={[styles.btn, className].filter(Boolean).join(" ")}
      onClick={toggle}
      aria-label={label}
      aria-pressed={dark}
      title={label}
      data-resolved={resolved}
      {...rest}
    >
      <span className={styles.stack} aria-hidden="true">
        <svg
          className={[styles.icon, styles.sun, !dark && styles.on].filter(Boolean).join(" ")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </svg>
        <svg
          className={[styles.icon, styles.moon, dark && styles.on].filter(Boolean).join(" ")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
        >
          <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" />
        </svg>
      </span>
    </button>
  );
}
