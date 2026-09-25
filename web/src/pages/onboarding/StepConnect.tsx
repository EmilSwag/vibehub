import { useCallback, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ConnectTools } from "../../components/ConnectTools";
import { DEVICE_CONNECT_SCOPE, TRACKER_SUPPORT_NOTICE } from "../../lib/connectPrompt";
import styles from "./Onboarding.module.css";

interface Props {
  onBack: () => void;
  onNext: () => void;
  /** Raised on the first heartbeat so the welcome step can say the tracker is
   *  already running instead of asking for it a second time. */
  onConnected: () => void;
}

/**
 * Step 4 — the "how does this actually work" moment. Without the tracker the
 * profile stays empty, so we ask here, but it's skippable: the Home banner
 * keeps offering it until the first heartbeat lands.
 *
 * When the first heartbeat *does* land here, the celebration layer takes over the
 * screen; dismissing it walks straight on to the welcome step rather than dropping
 * the person back on a step they have already finished.
 */
export function StepConnect({ onBack, onNext, onConnected }: Props) {
  const [connected, setConnected] = useState(false);
  const advance = useCallback(() => onNext(), [onNext]);
  const markConnected = useCallback(() => {
    setConnected(true);
    onConnected();
  }, [onConnected]);

  return (
    <div className={styles.step}>
      <h1 className={styles.title}>Connect VibeHub once</h1>
      <p className={styles.lead}>One setup per device. Friends see when you're coding.</p>

      <ConnectTools onConnected={markConnected} onCelebrated={advance} />

      <details className={styles.support}>
        <summary>What's supported</summary>
        <p>{DEVICE_CONNECT_SCOPE} {TRACKER_SUPPORT_NOTICE}</p>
      </details>

      <div className={styles.actions}>
        <button type="button" className={styles.linkButton} onClick={onBack}>
          Back
        </button>
        {connected ? (
          <Button type="button" onClick={onNext}>
            Continue
          </Button>
        ) : (
          <button type="button" className={styles.linkButton} onClick={onNext}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
}
