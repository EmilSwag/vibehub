import { useEffect, useRef, useState } from "react";
import { ApiError, usersApi } from "../../lib/api";
import type { GithubRepoSummary } from "../../types";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import styles from "./RepoPicker.module.css";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

function relativeDate(iso: string | null): string {
  if (!iso) return "never pushed";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "pushed today";
  if (days < 30) return `pushed ${days}d ago`;
  const months = Math.floor(days / 30);
  return `pushed ${months}mo ago`;
}

/**
 * Repo URL field's companion: browse the signed-in user's own GitHub repos
 * instead of hand-typing a URL. Fetches lazily, once, on first open.
 */
export function RepoPicker({ onPick }: { onPick: (repo: GithubRepoSummary) => void }) {
  const [open, setOpen] = useState(false);
  const [repos, setRepos] = useState<GithubRepoSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    setOpen((o) => !o);
    if (repos === null && !loading) {
      setLoading(true);
      setError(null);
      usersApi
        .githubRepos()
        .then((r) => setRepos(r.repos))
        .catch((err) => {
          setError(
            err instanceof ApiError && err.status === 409
              ? "Connect a GitHub account (sign in with GitHub) to browse your repos."
              : "Could not load your repos."
          );
        })
        .finally(() => setLoading(false));
    }
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button type="button" className={styles.trigger} onClick={toggle} aria-expanded={open}>
        <Icon name="github" size={13} />
        Browse GitHub
        <Icon name="chevronDown" size={11} className={cx(styles.chev, open && styles.chevOpen)} />
      </button>

      {open && (
        <div className={cx(styles.panel, "scale-in")} role="listbox" aria-label="Your GitHub repos">
          {loading ? (
            <div className={styles.loading}>
              <Skeleton height={13} width="70%" />
              <Skeleton height={13} width="55%" />
              <Skeleton height={13} width="62%" />
            </div>
          ) : error ? (
            <p className={styles.note}>{error}</p>
          ) : !repos?.length ? (
            <p className={styles.note}>No repos found on your GitHub account.</p>
          ) : (
            <ul className={styles.list}>
              {repos.map((r) => (
                <li key={r.fullName}>
                  <button
                    type="button"
                    className={styles.item}
                    onClick={() => {
                      onPick(r);
                      setOpen(false);
                    }}
                  >
                    <span className={styles.itemName}>
                      {r.fullName}
                      {r.private && <Icon name="eyeOff" size={11} className={styles.privateIcon} />}
                    </span>
                    <span className={styles.itemMeta}>
                      {r.language && <span>{r.language}</span>}
                      <span>{relativeDate(r.pushedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
