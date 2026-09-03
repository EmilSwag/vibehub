import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

/**
 * Replays the page reveal (fade + rise) on every route change by re-keying the
 * wrapper on pathname. Pure CSS animation from motion.css — no JS timers, and it
 * disappears entirely under prefers-reduced-motion.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="reveal">
      {children}
    </div>
  );
}
