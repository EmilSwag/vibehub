import type { ReactNode } from "react";
import { useAchievementUnlocks } from "../../hooks/useAchievementUnlocks";
import { TopBar } from "./TopBar";
import { SkewToastContainer } from "../ui/SkewToast";
import styles from "./AppLayout.module.css";

export function AppLayout({ children }: { children: ReactNode }) {
  // The owner's badge poll lives with the shell, once, so every signed-in screen can
  // raise the unlock toast below. A no-op while signed out (public profile pages).
  useAchievementUnlocks();

  return (
    <div className={styles.page}>
      <TopBar />
      <SkewToastContainer />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
