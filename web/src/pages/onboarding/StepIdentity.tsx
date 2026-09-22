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
      // GitHub sign-in falls back to `displayName = login` when the profile has no
      // name. The greeting ("Back at it, {displayName}") would then keep showing the
      // GitHub login after the user picked a nickname here (round 12). When the display
      // name is still that fallback, move it along with the nickname; a real name is
      // left alone.
      const displayNameFollows = user.displayName.trim().toLowerCase() === user.username.toLowerCase();
      const { user: updated } =
        normalized === user.username
          ? { user }
          : await usersApi.updateMe({ username: normalized, ...(displayNameFollows ? { displayName: normalized } : {}) });
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
            onChange={(e) => {
              setUsername(e.target.value);
              // "That nickname is taken" must not outlive the nickname it was about.
              if (error) setError(null);
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={24}
            autoFocus
            aria-invalid={(!valid && username.length > 0) || !!error ? true : undefined}
            aria-describedby={error ? "nickname-hint nickname-error" : "nickname-hint"}
          />
        </span>
        <span
          id="nickname-hint"
          className={[styles.fieldHint, !valid && username.length > 0 && styles.fieldHintBad].filter(Boolean).join(" ")}
        >
          3–24 characters · lowercase letters, digits, hyphens
        </span>
      </label>

      {error && (
        <p id="nickname-error" role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <div className={[styles.actions, styles.actionsField].join(" ")}>
        <Button type="submit" disabled={!valid || uploading} loading={saving}>
          Continue
        </Button>
      </div>
    </form>
  );
}
