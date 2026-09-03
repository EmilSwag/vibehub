import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { usersApi } from "../lib/api";
import type { ChangeEvent } from "react";
import type { ExternalLink, UserRole } from "../types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { FieldLabel, Input, Textarea } from "../components/ui/Input";
import { ROLES, RoleGlyph } from "../components/ui/RoleGlyph";
import { ConnectTools } from "../components/ConnectTools";
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

export function SettingsPage() {
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

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Tracker</h2>
        <ConnectTools variant="full" />
      </section>
    </div>
  );
}
