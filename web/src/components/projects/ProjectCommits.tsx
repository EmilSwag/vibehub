import { useEffect, useState } from "react";
import { projectsApi } from "../../lib/api";
import type { RepoActivity } from "../../types";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import styles from "./ProjectCommits.module.css";

interface Props {
  projectId: string;
  /** Skip the fetch (composer preview, non-GitHub repos). */
  disabled?: boolean;
  /** Rows shown before "show all". */
  limit?: number;
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * "Pushes" strip on a project card. Data comes from our API (server-side
 * GitHub fetch, cached), so the browser never needs a GitHub token.
 */
export function ProjectCommits({ projectId, disabled, limit = 3 }: Props) {
  const [data, setData] = useState<RepoActivity | null>(null);
  const [loading, setLoading] = useState(!disabled);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    setLoading(true);
    projectsApi
      .commits(projectId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData({ repo: null, commits: [], lastPushAt: null });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, disabled]);

  if (disabled) return null;

  if (loading) {
    return (
      <div className={styles.wrap} aria-busy="true">
        <div className={styles.head}>
          <Icon name="commit" size={13} />
          Pushes
        </div>
        <div className={styles.rows}>
          <Skeleton height={14} width="82%" />
          <Skeleton height={14} width="64%" />
        </div>
      </div>
    );
  }

  if (!data?.repo || data.commits.length === 0) return null;

  const rows = expanded ? data.commits : data.commits.slice(0, limit);

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <Icon name="commit" size={13} />
        Pushes
        {data.lastPushAt && <span className={styles.headMeta}>last {relative(data.lastPushAt)}</span>}
      </div>
      <ul className={[styles.rows, "stagger"].join(" ")}>
        {rows.map((c) => (
          <li key={c.sha} className={styles.row}>
            {c.authorAvatarUrl ? (
              <img className={styles.avatar} src={c.authorAvatarUrl} alt="" loading="lazy" />
            ) : (
              <span className={styles.avatarFallback} aria-hidden="true" />
            )}
            <a
              className={styles.message}
              href={c.url}
              target="_blank"
              rel="noreferrer"
              title={c.message}
              onClick={(e) => e.stopPropagation()}
            >
              {c.message}
            </a>
            <span className={styles.meta}>
              <code className={styles.sha}>{c.sha.slice(0, 7)}</code>
              {relative(c.committedAt)}
            </span>
          </li>
        ))}
      </ul>
      {data.commits.length > limit && (
        <button
          type="button"
          className={styles.more}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? "Show less" : `Show all ${data.commits.length}`}
        </button>
      )}
    </div>
  );
}
