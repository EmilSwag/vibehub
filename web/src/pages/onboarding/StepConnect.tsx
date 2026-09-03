import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { ConnectTools } from "../../components/ConnectTools";
import styles from "./Onboarding.module.css";

interface Props {
  onBack: () => void;
  onNext: () => void;
}

/**
 * Step 4 — the "how does this actually work" moment. Without the tracker the
 * profile stays empty, so we ask here, but it's skippable: the Home banner
 * keeps offering it until the first heartbeat lands.
 */
export function StepConnect({ onBack, onNext }: Props) {
  const [connected, setConnected] = useState(false);

  return (
    <div className={styles.step}>
      <h1 className={styles.title}>Connect your AI tools</h1>
      <p className={styles.lead}>
        Pick your tool, paste one prompt — status, hours and tokens, nothing else leaves your machine.
      </p>

      <ConnectTools onConnected={() => setConnected(true)} />

      <div className={styles.actions}>
        <button type="button" className={styles.linkButton} onClick={onBack}>
          Back
        </button>
        <Button type="button" onClick={onNext}>
          {connected ? "Continue" : "I'll do this later"}
        </Button>
      </div>
    </div>
  );
}
