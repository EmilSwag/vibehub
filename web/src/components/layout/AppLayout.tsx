import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import styles from "./AppLayout.module.css";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <TopBar />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
