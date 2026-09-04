import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usersApi } from "../lib/api";
import { useTheme } from "../lib/theme";
import type { ThemePreference } from "../lib/theme";
import type { ChangeEvent } from "react";
import type { ExternalLink, UserRole } from "../types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { FieldLabel, Input, Textarea } from "../components/ui/Input";
import { ROLES, RoleGlyph } from "../components/ui/RoleGlyph";
import { ConnectTools } from "../components/ConnectTools";
import { Skeleton } from "../components/ui/Skeleton";
import styles from "./SettingsPage.module.css";

function ProfileSection() {
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await usersApi.updateMe({ displayName, bio });
      await refresh();
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await usersApi.uploadAvatar(file);
      await refresh();
    } finally {
      setUploading(false);
    }
  }

  if (!user) return null;

  return (
    <Card>
      <div className={styles.avatarRow}>
        <Avatar src={user.avatarUrl} name={user.displayName} size={64} />
        <label>
          <Button
            type="button"
            variant="secondary"
            disabled={uploading}
            onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement)?.click()}
          >
            {uploading ? "Uploading…" : "Change avatar"}
          </Button>
          <input type="file" accept="image/*" hidden onChange={handleAvatarChange} />
        </label>
      </div>

      <form className={styles.form} onSubmit={handleSubmit} style={{ marginTop: 20 }}>
        <div>
          <FieldLabel htmlFor="s-name">Display name</FieldLabel>
          <Input id="s-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor="s-bio">Bio</FieldLabel>
          <Textarea
            id="s-bio"
            rows={3}
            maxLength={500}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {saved && <span className={styles.saved}>Saved.</span>}
        </div>
      </form>
    </Card>
  );
}

function LinksSection() {
  const { user } = useAuth();
  const [links, setLinks] = useState<{ url: string; label: string }[]>([]);
  const [saved, setSaved] = useState<ExternalLink[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    usersApi
      .get(user.username)
      .then(({ links }) => {
        setSaved(links);
        setLinks(links.map((l) => ({ url: l.url, label: l.label ?? "" })));
      })
      .finally(() => setLoading(false));
  }, [user]);

  function addRow() {
    setLinks((prev) => [...prev, { url: "", label: "" }]);
  }

  function updateRow(index: number, field: "url" | "label", value: string) {
    setLinks((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  function removeRow(index: number) {
    setLinks((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = links
        .filter((l) => l.url.trim())
        .map((l) => ({ url: l.url.trim(), label: l.label.trim() || undefined }));
      const { links: result } = await usersApi.putLinks(payload);
      setSaved(result);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card aria-busy="true">
        {[0, 1].map((i) => (
          <div className={styles.linkRow} key={i} style={{ marginBottom: 8 }}>
            <Skeleton height={36} width="60%" />
            <Skeleton height={36} width="30%" />
          </div>
        ))}
      </Card>
    );
  }

  return (
    <Card>
      {links.map((link, i) => (
        <div className={styles.linkRow} key={i} style={{ marginBottom: 8 }}>
          <Input
            placeholder="https://github.com/you"
            value={link.url}
            onChange={(e) => updateRow(i, "url", e.target.value)}
          />
          <Input
            placeholder="label (optional)"
            value={link.label}
            onChange={(e) => updateRow(i, "label", e.target.value)}
          />
          <button type="button" className={styles.removeBtn} onClick={() => removeRow(i)}>
            ×
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <Button type="button" variant="secondary" onClick={addRow}>
          Add link
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save links"}
        </Button>
      </div>
      {saved.length > 0 && <p className={styles.saved} style={{ marginTop: 12 }}>Saved {saved.length} link(s).</p>}
    </Card>
  );
}

/** Same five cards as onboarding, as toggle chips. Saves on each change. */
function RolesSection() {
  const { user, refresh } = useAuth();
  const [roles, setRoles] = useState<UserRole[]>(user?.roles ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: UserRole) {
    const next = roles.includes(id) ? roles.filter((r) => r !== id) : [...roles, id];
    if (next.length === 0) {
      setError("Keep at least one.");
      return;
    }
    setError(null);
    setRoles(next);
    setSaving(true);
    try {
      await usersApi.updateMe({ roles: next });
      await refresh();
    } catch {
      setRoles(roles);
      setError("Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div className={styles.chips} role="group" aria-label="Roles" aria-busy={saving}>
        {ROLES.map((r) => {
          const on = roles.includes(r.id);
          return (
            <button
              key={r.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              className={[styles.chip, on && styles.chipOn].filter(Boolean).join(" ")}
              onClick={() => toggle(r.id)}
            >
              <RoleGlyph role={r.id} size={18} />
              {r.title}
            </button>
          );
        })}
      </div>
      {error && <p className={styles.saved}>{error}</p>}
    </Card>
  );
}

const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** Theme is a per-device preference (localStorage), not a profile field: no save
 * button, each click applies and persists at once. Radio-group semantics with
 * roving tabindex — arrows move the choice, Home/End jump to the ends. */
function AppearanceSection() {
  const { preference, setPreference } = useTheme();
  const groupRef = useRef<HTMLDivElement>(null);
  const index = Math.max(0, THEME_OPTIONS.findIndex((o) => o.id === preference));

  function choose(next: number, focus: boolean) {
    const option = THEME_OPTIONS[next];
    if (!option) return;
    setPreference(option.id);
    if (focus) {
      const radios = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      radios?.[next]?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const n = THEME_OPTIONS.length;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % n;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + n) % n;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = n - 1;
    if (next === null) return;
    event.preventDefault();
    choose(next, true);
  }

  return (
    <Card>
      <div
        ref={groupRef}
        className={styles.seg}
        role="radiogroup"
        aria-label="Theme"
        onKeyDown={handleKeyDown}
        style={{ "--seg-index": index } as CSSProperties}
      >
        <span className={styles.segThumb} aria-hidden="true" />
        {THEME_OPTIONS.map((option, i) => {
          const on = option.id === preference;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className={[styles.segBtn, on && styles.segBtnOn].filter(Boolean).join(" ")}
              onClick={() => choose(i, false)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className={styles.hint}>System follows your device.</p>
    </Card>
  );
}

export function SettingsPage() {
  // "/settings#tracker" (the Home tracking panel links here): the SPA router
  // doesn't scroll to hashes on its own. The sections above load async and grow
  // out of their skeletons, so keep re-anchoring while the layout settles.
  const { hash } = useLocation();
  useEffect(() => {
    if (hash !== "#tracker") return;
    const target = document.getElementById("tracker");
    if (!target) return;
    const jump = () => target.scrollIntoView({ block: "start" });
    jump();
    const observer = new ResizeObserver(jump);
    observer.observe(document.body);
    const stop = window.setTimeout(() => observer.disconnect(), 1200);
    return () => {
      observer.disconnect();
      window.clearTimeout(stop);
    };
  }, [hash]);

  return (
    <div>
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Profile</h2>
        <ProfileSection />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>What you make</h2>
        <RolesSection />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>External links</h2>
        <LinksSection />
      </section>

      <section id="tracker" className={[styles.section, styles.tracker].join(" ")}>
        <h2 className={styles.sectionTitle}>Tracker</h2>
        <ConnectTools variant="full" />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Appearance</h2>
        <AppearanceSection />
      </section>
    </div>
  );
}
