import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import styles from "./SectionTitle.module.css";

interface Props {
  icon: IconName;
  children: ReactNode;
  /** Right-aligned count pill; hidden when 0/undefined. */
  count?: number;
  /** `hot` = filled pill for things that need attention (incoming requests). */
  tone?: "default" | "hot";
  /** Optional trailing slot (link, small button). */
  aside?: ReactNode;
}

/** Uppercase eyebrow header used above cards on Home / Friends / Profile. The
 * count sits on the right edge so numbers line up across a column of cards. */
export function SectionTitle({ icon, children, count, tone = "default", aside }: Props) {
  return (
    <h2 className={styles.title}>
      <Icon name={icon} size={14} className={styles.icon} />
      <span className={styles.label}>{children}</span>
      {!!count && <span className={[styles.pill, tone === "hot" && styles.pillHot].filter(Boolean).join(" ")}>{count}</span>}
      {aside && <span className={styles.aside}>{aside}</span>}
    </h2>
  );
}
