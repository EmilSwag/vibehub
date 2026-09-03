import { useState } from "react";
import type { CSSProperties } from "react";
import { usersApi } from "../../lib/api";
import type { User, UserRole } from "../../types";
import { Button } from "../../components/ui/Button";
import { RoleGlyph, ROLES } from "../../components/ui/RoleGlyph";
import styles from "./Onboarding.module.css";

interface Props {
  user: User;
  onSaved: (user: User) => void;
  onBack: () => void;
  onNext: () => void;
}

export function StepRole({ user, onSaved, onBack, onNext }: Props) {
  const [roles, setRoles] = useState<UserRole[]>(user.roles ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: UserRole) =>
    setRoles((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));

  const submit = async () => {
    if (roles.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { user: updated } = await usersApi.updateMe({ roles });
      onSaved(updated);
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.step}>
      <h1 className={styles.title}>What do you make?</h1>
      <p className={styles.lead}>Pick everything that fits — most of us wear a few hats.</p>

      <div className={[styles.roleGrid, "stagger"].join(" ")} role="group" aria-label="Roles">
        {ROLES.map((r, i) => {
          const selected = roles.includes(r.id);
          return (
            <button
              key={r.id}
              type="button"
              role="checkbox"
              aria-checked={selected}
              className={[styles.roleCard, selected && styles.roleCardSelected].filter(Boolean).join(" ")}
              style={{ "--i": i } as CSSProperties}
              onClick={() => toggle(r.id)}
            >
              <span className={styles.roleGlyph}>
                <RoleGlyph role={r.id} size={26} />
              </span>
              <span className={styles.roleText}>
                <span className={styles.roleTitle}>{r.title}</span>
                <span className={styles.roleBlurb}>{r.blurb}</span>
              </span>
              <span className={styles.roleCheck} aria-hidden="true">
                {selected && (
                  <svg className="pop" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7" />
                  </svg>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.linkButton} onClick={onBack}>
          Back
        </button>
        <Button type="button" onClick={submit} disabled={roles.length === 0 || saving}>
          {saving ? "Saving…" : roles.length > 1 ? `Continue with ${roles.length}` : "Continue"}
        </Button>
      </div>
    </div>
  );
}
