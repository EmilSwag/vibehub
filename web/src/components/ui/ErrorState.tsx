import type { ReactNode } from "react";
import { Button } from "./Button";
import styles from "./ErrorState.module.css";

interface ErrorStateProps {
  /** One plain sentence. No "Oops", no status codes, no stack. */
  children: ReactNode;
  onRetry: () => void;
  /** The caller's own empty-state class — an error sits in the same padded box. */
  className?: string;
}

/**
 * A failed load, stated where the content would have been (skills/emil_design_eng §5:
 * "errors are inline, near the control, plain language, with retry").
 *
 * This exists because the alternative is worse than ugly: a swallowed rejection leaves
 * the block rendering its *empty* state, which tells the user the opposite of the truth
 * — "no friends yet" instead of "we couldn't load them". Retry puts the block back into
 * its skeleton, so the recovery looks like the first load rather than a second state.
 */
export function ErrorState({ children, onRetry, className }: ErrorStateProps) {
  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")} role="status">
      <span className={styles.text}>{children}</span>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
