import type { CSSProperties } from "react";
import styles from "./Skeleton.module.css";

interface SkeletonProps {
  /** `line` = text row, `circle` = avatar, `block` = card/image area, `pill` = button. */
  variant?: "line" | "circle" | "block" | "pill";
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Shape-matched loading placeholder (skills/emil_design_eng §5): render the exact
 * silhouette of the final content so nothing jumps when data arrives.
 */
export function Skeleton({ variant = "line", width, height, className, style }: SkeletonProps) {
  const size: CSSProperties = { ...style };
  if (width !== undefined) size.width = width;
  if (height !== undefined) size.height = height;
  if (variant === "circle" && height === undefined && width !== undefined) size.height = width;

  return (
    <span
      aria-hidden="true"
      className={[styles.skeleton, styles[variant], className].filter(Boolean).join(" ")}
      style={size}
    />
  );
}

/** Avatar + two lines + optional trailing pill — the shape of every user row we render. */
export function SkeletonRow({ withAction = false, count = 1 }: { withAction?: boolean; count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.row} style={{ "--i": i } as CSSProperties}>
          <Skeleton variant="circle" width={40} />
          <div className={styles.rowText}>
            <Skeleton width="42%" height={13} />
            <Skeleton width="28%" height={11} />
          </div>
          {withAction && <Skeleton variant="pill" width={72} height={32} />}
        </div>
      ))}
    </>
  );
}

/** A few text lines — for bios, descriptions, stat blocks. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className={styles.text}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? "55%" : "100%"} />
      ))}
    </div>
  );
}
