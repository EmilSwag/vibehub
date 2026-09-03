import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { friendsApi, usersApi } from "../../lib/api";
import type { SuggestedUser } from "../../types";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { LevelBadge } from "../../components/ui/LevelBadge";
import { SkeletonRow } from "../../components/ui/Skeleton";
import { rolesLabel } from "../../components/ui/RoleGlyph";
import styles from "./Onboarding.module.css";

interface Props {
  onInvited: (count: number) => void;
  onBack: () => void;
  onNext: () => void;
}

export function StepFriends({ onInvited, onBack, onNext }: Props) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<SuggestedUser[] | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Debounced search; empty query = newest people on the hub.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      usersApi
        .suggested(query.trim() || undefined)
        .then(({ users, invitedIds }) => {
          if (cancelled) return;
          setUsers(users);
          setInvited((prev) => new Set([...prev, ...invitedIds]));
        })
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load people"));
    }, query ? 220 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    onInvited(invited.size);
  }, [invited, onInvited]);

  const invite = async (u: SuggestedUser) => {
    if (invited.has(u.id) || pending.has(u.id)) return;
    setPending((p) => new Set(p).add(u.id));
    setError(null);
    try {
      await friendsApi.sendRequest(u.username);
      setInvited((s) => new Set(s).add(u.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send invite");
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(u.id);
        return next;
      });
    }
  };

  return (
    <div className={styles.step}>
      <h1 className={styles.title}>Add the people you know</h1>
      <p className={styles.lead}>They'll see you're here and can accept in one tap.</p>

      <input
        className={[styles.input, styles.search].join(" ")}
        placeholder="Search by nickname or name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />

      <div className={styles.list} aria-busy={users === null}>
        {users === null ? (
          <SkeletonRow count={5} withAction />
        ) : users.length === 0 ? (
          <p className={styles.emptyRow}>
            {query ? "Nobody by that name yet." : "You're early — nobody else is here yet. Share the link and come back."}
          </p>
        ) : (
          <ul className={[styles.rows, "stagger"].join(" ")}>
            {users.map((u, i) => {
              const done = invited.has(u.id);
              const busy = pending.has(u.id);
              return (
                <li key={u.id} className={styles.row} style={{ "--i": i } as CSSProperties}>
                  <Avatar src={u.avatarUrl} name={u.displayName} size={40} />
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{u.displayName}</span>
                    <span className={styles.rowMeta}>
                      @{u.username}
                      {rolesLabel(u.roles) && <> · {rolesLabel(u.roles)}</>}
                    </span>
                  </span>
                  <LevelBadge level={u.level} size="sm" className={styles.level} />
                  <Button
                    type="button"
                    variant={done ? "secondary" : "primary"}
                    className={[styles.inviteButton, done && "pop"].filter(Boolean).join(" ")}
                    onClick={() => invite(u)}
                    disabled={done || busy}
                  >
                    {done ? "Invited" : busy ? "…" : "Invite"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.linkButton} onClick={onBack}>
          Back
        </button>
        <Button type="button" onClick={onNext}>
          {invited.size > 0 ? "Continue" : "Skip for now"}
        </Button>
      </div>
    </div>
  );
}
