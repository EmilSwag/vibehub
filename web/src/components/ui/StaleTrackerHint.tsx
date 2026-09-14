import type { StaleStatus } from "../../lib/trackerPing";
import { staleTrackerHint } from "../../lib/trackerPing";
import styles from "./StaleTrackerHint.module.css";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/**
 * The only place the "old token" sentences are rendered.
 *
 * Home's strip, the Settings panel and the connect sheet all ask the same question, so
 * they all get the same answer in the same words — a second wording for the same state
 * is how a product ends up telling one person to reinstall and another to restart.
 *
 * The rule (`!connected && staleTracker`) lives in lib/trackerPing.ts and is pinned by
 * its check file; this component only decides how it looks. It renders nothing at all
 * when the rule says nothing, so callers need no condition of their own.
 */
export function StaleTrackerHint({ status, className }: { status: StaleStatus | null; className?: string }) {
  const hint = staleTrackerHint(status);
  if (!hint) return null;

  return (
    <p className={cx(styles.hint, className)}>
      {/* A real space, not a margin. The two sentences are separate elements so the
          first can carry weight, but a CSS gap is invisible to the text layer: screen
          readers and copy-paste ran them together as "old token.Run step 1". */}
      <span className={styles.lead}>{hint.lead}</span>{" "}
      <span className={styles.fix}>{hint.fix}</span>
    </p>
  );
}
