import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, projectsApi } from "../../lib/api";
import { stagger } from "../../lib/motion";
import type { RepoTree } from "../../types";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import styles from "./RepoBrowser.module.css";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** Languages shown in the bar before the tail folds into "Other". */
const MAX_LANGUAGES = 5;
const SKELETON_ROWS = 6;

/** "812 B" / "4.6 kB" / "1.2 MB" — decimal units, the way GitHub prints them. */
function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Strict monochrome: the share bar is one ink at descending opacity, never a hue.
 *  Index 0 is the dominant language and the darkest band. */
const shadeFor = (index: number) => Math.max(0.14, 0.86 - index * 0.15);

interface LanguageBand {
  name: string;
  share: number;
  shade: number;
}

function toBands(languages: { name: string; share: number }[]): LanguageBand[] {
  const head = languages.slice(0, MAX_LANGUAGES);
  const tail = languages.slice(MAX_LANGUAGES);
  const bands = head.map((l, i) => ({ name: l.name, share: l.share, shade: shadeFor(i) }));
  const rest = tail.reduce((sum, l) => sum + l.share, 0);
  if (rest > 0.005) bands.push({ name: "Other", share: rest, shade: shadeFor(bands.length) });
  return bands;
}

const percent = (share: number) => `${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%`;

function Languages({ languages }: { languages: { name: string; share: number }[] }) {
  const bands = toBands(languages);
  if (bands.length === 0) return null;

  return (
    <div className={styles.languages}>
      <div className={styles.bar} role="img" aria-label={bands.map((b) => `${b.name} ${percent(b.share)}`).join(", ")}>
        {bands.map((b) => (
          <span
            key={b.name}
            className={styles.band}
            style={{ flexGrow: Math.max(b.share, 0.001), opacity: b.shade }}
          />
        ))}
      </div>
      <ul className={styles.legend}>
        {bands.map((b) => (
          <li key={b.name} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ opacity: b.shade }} aria-hidden="true" />
            {b.name}
            <span className={styles.legendShare}>{percent(b.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EntriesSkeleton() {
  return (
    <ul className={styles.entries} aria-hidden="true">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <li key={i} className={styles.entry}>
          <Skeleton variant="circle" width={16} />
          <Skeleton width={`${34 + ((i * 13) % 30)}%`} height={13} />
          <Skeleton width={48} height={12} />
        </li>
      ))}
    </ul>
  );
}

interface Props {
  projectId: string;
  /** Shown in the "GitHub is busy" fallback so there is always a way through. */
  repoUrl: string;
  className?: string;
}

/**
 * The code itself, on the project page.
 *
 * One directory level at a time, GitHub-style: folders first, then files, each row
 * a name and a size. Clicking a folder loads `?path=` and swaps the listing in
 * place, with a breadcrumb back to the root — the page never navigates away.
 *
 * The root listing also carries the two things that describe a repo at a glance: a
 * monochrome language bar and the README's first paragraphs as plain text.
 *
 * Degrades in three directions, all of them calm: GitHub busy (503) → one line and
 * a link out; no GitHub repo (404) → the block removes itself and the page keeps
 * its links; a folder that fails → the row list stays on the last good path.
 */
export function RepoBrowser({ projectId, repoUrl, className }: Props) {
  const [path, setPath] = useState("");
  const [root, setRoot] = useState<RepoTree | null>(null);
  const [tree, setTree] = useState<RepoTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [gone, setGone] = useState(false);
  const cache = useRef(new Map<string, RepoTree>());

  useEffect(() => {
    cache.current = new Map();
    setPath("");
    setRoot(null);
    setTree(null);
    setGone(false);
    setUnavailable(false);
  }, [projectId]);

  useEffect(() => {
    const cached = cache.current.get(path);
    if (cached) {
      setTree(cached);
      setLoading(false);
      setUnavailable(false);
      return;
    }

    let active = true;
    setLoading(true);
    projectsApi
      .repo(projectId, path)
      .then((res) => {
        if (!active) return;
        cache.current.set(path, res);
        setTree(res);
        if (path === "") setRoot(res);
        setUnavailable(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        // 404 on the root means "no GitHub repo here" — hide the whole block rather
        // than explain an absence. Anything else is GitHub being GitHub.
        if (err instanceof ApiError && err.status === 404 && path === "") setGone(true);
        else setUnavailable(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [projectId, path]);

  const crumbs = useMemo(() => (path === "" ? [] : path.split("/")), [path]);
  const openPath = useCallback((next: string) => setPath(next), []);

  if (gone) return null;

  if (unavailable && !tree) {
    return (
      <div className={cx(styles.wrap, className)}>
        <p className={styles.calm}>
          GitHub is busy —{" "}
          <a href={repoUrl} target="_blank" rel="noreferrer" className={styles.calmLink}>
            open the repo
          </a>
          .
        </p>
      </div>
    );
  }

  const rootName = root?.repo.repo ?? tree?.repo.repo ?? "Code";
  const entries = tree?.entries ?? [];

  return (
    <div className={cx(styles.wrap, className)}>
      {loading && !root ? (
        <div className={styles.headSkeleton}>
          <Skeleton height={8} width="100%" />
          <Skeleton height={12} width="70%" />
        </div>
      ) : (
        root?.languages && root.languages.length > 0 && <Languages languages={root.languages} />
      )}

      {root?.readme && (
        <div className={styles.readme}>
          <p className={styles.readmeText}>{root.readme.excerpt}</p>
          <a href={root.readme.url} target="_blank" rel="noreferrer" className={styles.readmeLink}>
            Read on GitHub
            <Icon name="external" size={12} />
          </a>
        </div>
      )}

      <nav className={styles.crumbs} aria-label="Folder">
        <button
          type="button"
          className={cx(styles.crumb, crumbs.length === 0 && styles.crumbCurrent)}
          onClick={() => openPath("")}
          disabled={crumbs.length === 0}
        >
          {rootName}
        </button>
        {crumbs.map((seg, i) => {
          const target = crumbs.slice(0, i + 1).join("/");
          const isLast = i === crumbs.length - 1;
          return (
            <span key={target} className={styles.crumbPart}>
              <span className={styles.crumbSep} aria-hidden="true">
                /
              </span>
              <button
                type="button"
                className={cx(styles.crumb, isLast && styles.crumbCurrent)}
                onClick={() => openPath(target)}
                disabled={isLast}
              >
                {seg}
              </button>
            </span>
          );
        })}
        {tree && (
          <span className={styles.branch}>
            {tree.defaultBranch}
          </span>
        )}
      </nav>

      {unavailable && (
        <p className={styles.calm}>
          GitHub is busy —{" "}
          <a href={repoUrl} target="_blank" rel="noreferrer" className={styles.calmLink}>
            open the repo
          </a>
          .
        </p>
      )}

      {loading && entries.length === 0 ? (
        <EntriesSkeleton />
      ) : entries.length === 0 ? (
        <p className={styles.calm}>Nothing in this folder.</p>
      ) : (
        // The previous listing stays put while the next one loads: same rows, one
        // step dimmer, so opening a folder never collapses the page under the cursor.
        <ul className={cx(styles.entries, "stagger", loading && styles.entriesBusy)} aria-busy={loading || undefined}>
          {entries.map((entry, i) => (
            <li key={`${entry.type}:${entry.name}`} className={styles.entry} style={stagger(i)}>
              <Icon name={entry.type === "dir" ? "folder" : "file"} size={16} className={styles.entryGlyph} />
              {entry.type === "dir" ? (
                <button
                  type="button"
                  className={cx(styles.entryName, styles.entryButton)}
                  onClick={() => openPath(path ? `${path}/${entry.name}` : entry.name)}
                >
                  {entry.name}
                </button>
              ) : (
                <a className={styles.entryName} href={entry.url} target="_blank" rel="noreferrer">
                  {entry.name}
                </a>
              )}
              <span className={styles.entrySize}>{formatBytes(entry.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
