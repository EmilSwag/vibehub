import type { CSSProperties } from "react";
import type { User } from "../../types";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { Confetti } from "../../components/ui/Confetti";
import { rolesLabel } from "../../components/ui/RoleGlyph";
import styles from "./Onboarding.module.css";

interface Props {
  user: User;
  invited: number;
  busy: boolean;
  /** True once a heartbeat landed during the connect step — the tracker is
   *  already running, so this screen must not ask for it again. */
  tracking: boolean;
  onEnter: () => void;
}

const WORDS = ["Welcome,", "bro."];

export function StepWelcome({ user, invited, busy, tracking, onEnter }: Props) {
  const chips = [
    `@${user.username}`,
    rolesLabel(user.roles) ?? "Explorer",
    invited > 0 ? `${invited} invite${invited === 1 ? "" : "s"} sent` : "Friends can find you",
  ];

  return (
    <div className={[styles.step, styles.welcome].join(" ")}>
      <Confetti />

      <div className={[styles.welcomeAvatar, "scale-in"].join(" ")}>
        <Avatar src={user.avatarUrl} name={user.displayName} size={88} />
      </div>

      <h1 className={[styles.title, styles.welcomeTitle].join(" ")} aria-label={WORDS.join(" ")}>
        {WORDS.map((w, i) => (
          <span key={w} className={styles.word} style={{ "--i": i } as CSSProperties} aria-hidden="true">
            {w}
          </span>
        ))}
      </h1>
      <p className={[styles.lead, "reveal"].join(" ")} style={{ animationDelay: "420ms" }}>
        {tracking
          ? "You're in. Your friends can see what you're building."
          : "You're in. Start the tracker and your friends will see what you're building."}
      </p>

      <ul className={[styles.chips, "stagger"].join(" ")} style={{ "--stagger": "70ms" } as CSSProperties}>
        {chips.map((c, i) => (
          <li key={c} className={styles.chip} style={{ "--i": i + 8 } as CSSProperties}>
            {c}
          </li>
        ))}
      </ul>

      <div className={[styles.actions, styles.actionsCenter, "reveal"].join(" ")} style={{ animationDelay: "900ms" }}>
        <Button type="button" onClick={onEnter} disabled={busy} autoFocus>
          {busy ? "Opening…" : "Enter VibeHub"}
        </Button>
      </div>
    </div>
  );
}
