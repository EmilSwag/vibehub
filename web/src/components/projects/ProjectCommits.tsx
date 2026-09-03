import { useEffect, useState } from "react";
import { projectsApi } from "../../lib/api";
import { formatShortDate } from "../../lib/format";
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
  /** `card` = compact strip on ProjectCard (default); `page` = full project page —
   *  also renders build/release and shows an honest empty state instead of hiding. */
  variant?: "card" | "page";
}

const BUILD_LABELS: Record<string, string> = {
  success: "Passing",
  failure: "Failing",
  in_progress: "Running",
  queued: "Queued",
  cancelled: "Cancelled",
};

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatShortDate(iso);
}

/**
 * "Pushes" strip on a project card. Data comes from our API (server-side
 * GitHub fetch, cached), so the browser never needs a GitHub token.
 */
export function ProjectCommits({ projectId, disabled, limit = 3, variant = "card" }: Props) {
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
        if (!cancelled) setData({ repo: null, commits: [], lastPushAt: null, build: null, latestRelease: null });
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

  const noPushes = !data?.repo || data.commits.length === 0;
  if (variant === "card" && noPushes) return null;

  const rows = data ? (expanded ? data.commits : data.commits.slice(0, limit)) : [];
  const build = data?.build ?? null;
  const release = data?.latestRelease ?? null;

  return (
    <div className={styles.wrap}>
      {variant === "page" && (build || release) && (
        <div className={styles.badges}>
          {build && (
            <a className={styles.badge} href={build.url} target="_blank" rel="noreferrer">
              <Icon name={build.status === "success" ? "check" : build.status === "failure" ? "x" : "commit"} size={12} />
              {BUILD_LABELS[build.status] ?? build.status}
              <span className={styles.badgeMeta}>{build.branch}</span>
            </a>
          )}
          {release && (
            <a className={styles.badge} href={release.url} target="_blank" rel="noreferrer">
              <Icon name="tag" size={12} />
              {release.tag}
            </a>
          )}
        </div>
      )}

      <div className={styles.head}>
        <Icon name="commit" size={13} />
        Pushes
        {data?.lastPushAt && <span className={styles.headMeta}>last {relative(data.lastPushAt)}</span>}
      </div>

      {noPushes ? (
        variant === "page" && <p className={styles.empty}>No pushes yet.</p>
      ) : (
        <>
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
          {data && data.commits.length > limit && (
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
        </>
      )}
    </div>
  );
}
