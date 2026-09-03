import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { usersApi } from "../lib/api";
import type { ChangeEvent } from "react";
import type { ExternalLink, TrackerToken } from "../types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { FieldLabel, Input, Textarea } from "../components/ui/Input";
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

function TrackerTokensSection() {
  const [tokens, setTokens] = useState<TrackerToken[]>([]);
  const [label, setLabel] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    usersApi.listTrackerTokens().then(({ tokens }) => setTokens(tokens));
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!label.trim()) return;
    setCreating(true);
    try {
      const { token, tokenId } = await usersApi.createTrackerToken(label.trim());
      setNewToken(token);
      setTokens((prev) => [...prev, { id: tokenId, label: label.trim(), lastUsedAt: null, revokedAt: null }]);
      setLabel("");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    await usersApi.revokeTrackerToken(id);
    setTokens((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <Card>
      <form className={styles.newTokenForm} onSubmit={handleCreate}>
        <Input
          placeholder="e.g. MacBook Pro"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button type="submit" disabled={creating || !label.trim()}>
          {creating ? "Creating…" : "Create token"}
        </Button>
      </form>

      {newToken && (
        <div className={styles.tokenValue}>
          {newToken}
          <br />
          <span style={{ color: "var(--vh-text-faint)", fontSize: 12 }}>
            Shown once — copy it into ~/.vibehub/config.json now.
          </span>
        </div>
      )}

      {tokens.length === 0 ? (
        <p className={styles.saved}>No tracker devices yet.</p>
      ) : (
        tokens.map((token) => (
          <div className={styles.tokenRow} key={token.id}>
            <div>
              <div className={styles.tokenLabel}>{token.label}</div>
              <div className={styles.tokenMeta}>
                {token.lastUsedAt ? `last used ${token.lastUsedAt}` : "never used"}
              </div>
            </div>
            <button type="button" className={styles.removeBtn} onClick={() => handleRevoke(token.id)}>
              revoke
            </button>
          </div>
        ))
      )}
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
        <h2 className={styles.sectionTitle}>External links</h2>
        <LinksSection />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Tracker devices</h2>
        <TrackerTokensSection />
      </section>
    </div>
  );
}
