import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, usersApi } from "../../lib/api";
import type { User } from "../../types";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import styles from "./Onboarding.module.css";

const USERNAME_RE = /^[a-z0-9-]{3,24}$/;

interface Props {
  user: User;
  onSaved: (user: User) => void;
  onNext: () => void;
}

export function StepIdentity({ user, onSaved, onNext }: Props) {
  const [username, setUsername] = useState(user.username);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarPop, setAvatarPop] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const normalized = username.trim().toLowerCase();
  const valid = USERNAME_RE.test(normalized);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { avatarUrl: url } = await usersApi.uploadAvatar(file);
      setAvatarUrl(url);
      setAvatarPop(true);
      onSaved({ ...user, avatarUrl: url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { user: updated } =
        normalized === user.username ? { user } : await usersApi.updateMe({ username: normalized });
      onSaved({ ...updated, avatarUrl });
      onNext();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "That nickname is taken — try another."
          : err instanceof Error
            ? err.message
            : "Could not save"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.step} onSubmit={submit}>
      <h1 className={styles.title}>Who are you here?</h1>
      <p className={styles.lead}>Pick a nickname and a face. You can change both later.</p>

      <button
        type="button"
        className={[styles.avatarButton, avatarPop && "pop"].filter(Boolean).join(" ")}
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        aria-label="Change avatar"
        onAnimationEnd={() => setAvatarPop(false)}
      >
        <Avatar src={avatarUrl} name={user.displayName} size={96} />
        <span className={styles.avatarHint}>{uploading ? "Uploading…" : "Change"}</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => pickFile(e.target.files?.[0])}
      />

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Nickname</span>
        <span className={styles.inputWrap}>
          <span className={styles.inputPrefix}>@</span>
          <input
            className={styles.input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={24}
            autoFocus
          />
        </span>
        <span className={[styles.fieldHint, !valid && username.length > 0 && styles.fieldHintBad].filter(Boolean).join(" ")}>
          3–24 characters · lowercase letters, digits, hyphens
        </span>
      </label>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <Button type="submit" disabled={!valid || saving || uploading}>
          {saving ? "Saving…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}
