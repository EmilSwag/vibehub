import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Opening a page lands at the top of it.
 *
 * React Router keeps the document's scroll offset across route changes, so
 * clicking a profile from the bottom of Home used to drop the visitor halfway
 * down someone else's page. Mounted once in `App`, above the routes.
 *
 * POP is deliberately excluded: browser back/forward must restore where the
 * visitor was, the same way a normal document does. Every other navigation —
 * PUSH and REPLACE, including `/u/a → /u/b`, where only the params change —
 * scrolls to the top.
 *
 * `behavior: "auto"` on purpose: a smooth scroll of a page that is being
 * replaced animates the *old* content, which reads as a glitch, and would need
 * a reduced-motion branch of its own.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === "POP") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, navigationType]);

  return null;
}
