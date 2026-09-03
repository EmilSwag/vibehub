import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { usersApi } from "../../lib/api";
import { StepIdentity } from "./StepIdentity";
import { StepRole } from "./StepRole";
import { StepFriends } from "./StepFriends";
import { StepConnect } from "./StepConnect";
import { StepWelcome } from "./StepWelcome";
import { Logo } from "../../components/ui/Logo";
import styles from "./Onboarding.module.css";

const STEPS = ["identity", "role", "friends", "connect", "welcome"] as const;
const STEP_KEY = "vh.onboarding.step";
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
  // Survive a reload mid-wizard (a token was just minted, a terminal opened…):
  // resume where the user was, but never *ahead* of what the account allows.
  const [step, setStep] = useState<Step>(() => {
    const floor: Step = user?.roles?.length ? "friends" : "identity";
    const saved = sessionStorage.getItem(STEP_KEY) as Step | null;
    if (saved && STEPS.includes(saved) && STEPS.indexOf(saved) > STEPS.indexOf(floor)) return saved;
    return floor;
  });
  const [invited, setInvited] = useState(0);
  const [finishing, setFinishing] = useState(false);

  const index = STEPS.indexOf(step);
  const go = useCallback((next: Step) => {
    sessionStorage.setItem(STEP_KEY, next);
    setStep(next);
  }, []);

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      const { user: updated } = await usersApi.completeOnboarding();
      sessionStorage.removeItem(STEP_KEY);
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
        <Logo size={16} className={styles.brandMark} />
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
            onNext={() => go("connect")}
          />
        )}
        {step === "connect" && (
          <StepConnect onBack={() => go("friends")} onNext={() => go("welcome")} />
        )}
        {step === "welcome" && (
          <StepWelcome user={user} invited={invited} busy={finishing} onEnter={finish} />
        )}
      </div>
    </div>
  );
}
