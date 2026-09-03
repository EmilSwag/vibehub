import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { usersApi } from "../../lib/api";
import { StepIdentity } from "./StepIdentity";
import { StepRole } from "./StepRole";
import { StepFriends } from "./StepFriends";
import { StepWelcome } from "./StepWelcome";
import styles from "./Onboarding.module.css";

const STEPS = ["identity", "role", "friends", "welcome"] as const;
type Step = (typeof STEPS)[number];

/**
 * First-run wizard (skills/emil_design_eng §6). Full-screen, no app nav. Each step
 * persists its own data immediately (PATCH /users/me, friend requests), so closing
 * the tab mid-way loses nothing; onboardedAt is only set on the final "Enter".
 */
export function OnboardingPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  // Resume where the user left off: role saved → skip identity, etc.
  const [step, setStep] = useState<Step>(() => (user?.role ? "friends" : "identity"));
  const [invited, setInvited] = useState(0);
  const [finishing, setFinishing] = useState(false);

  const index = STEPS.indexOf(step);
  const go = useCallback((next: Step) => setStep(next), []);

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      const { user: updated } = await usersApi.completeOnboarding();
      setUser(updated);
      navigate("/", { replace: true });
    } finally {
      setFinishing(false);
    }
  }, [finishing, navigate, setUser]);

  if (!user) return null;

  return (
    <div className={styles.screen}>
      <div className={styles.brand}>
        <span className={styles.brandMark} />
        VibeHub
      </div>

      <ol className={styles.dots} aria-label={`Step ${index + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={[styles.dot, i === index && styles.dotActive, i < index && styles.dotDone]
              .filter(Boolean)
              .join(" ")}
          />
        ))}
      </ol>

      {/* key={step} replays the slide-in on every step change */}
      <div key={step} className={[styles.stage, "step-enter"].join(" ")}>
        {step === "identity" && (
          <StepIdentity user={user} onSaved={setUser} onNext={() => go("role")} />
        )}
        {step === "role" && (
          <StepRole user={user} onSaved={setUser} onBack={() => go("identity")} onNext={() => go("friends")} />
        )}
        {step === "friends" && (
          <StepFriends
            onInvited={(n) => setInvited(n)}
            onBack={() => go("role")}
            onNext={() => go("welcome")}
          />
        )}
        {step === "welcome" && (
          <StepWelcome user={user} invited={invited} busy={finishing} onEnter={finish} />
        )}
      </div>
    </div>
  );
}
