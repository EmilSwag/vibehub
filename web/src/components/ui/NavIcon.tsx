import type { CSSProperties } from "react";
import styles from "./NavIcon.module.css";

/**
 * Header/navigation icons generated through the QCAI image pipeline
 * (see web/public/icons/README.md for provenance). Each icon is a 256x256
 * RGBA PNG with black strokes on transparent; the component paints it with
 * `currentColor` through a CSS mask, so the glyph follows text colour in both
 * themes exactly like the inline SVG `Icon` does.
 */
export const NAV_ICON_NAMES = [
  "home",
  "friends",
  "projects",
  "settings",
  "user",
  "logout",
  "inbox",
  "sun",
  "moon",
] as const;

export type NavIconName = (typeof NAV_ICON_NAMES)[number];

interface NavIconProps {
  name: NavIconName;
  /** Rendered box in px (square). Defaults to 18 to sit next to 14px labels. */
  size?: number;
  className?: string;
}

export function NavIcon({ name, size = 18, className }: NavIconProps) {
  const style = {
    "--icon-url": `url("/icons/${name}.png")`,
    width: size,
    height: size,
  } as CSSProperties;
  return (
    <span
      role="img"
      aria-hidden="true"
      data-icon={name}
      className={[styles.icon, className].filter(Boolean).join(" ")}
      style={style}
    />
  );
}
