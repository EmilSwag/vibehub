import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { clampWords, updatedLabel } from "../lib/format";
import { githubRepoOf } from "../lib/projectUrl";
import { useProjectDigest } from "../lib/useProjectDigest";
import type { Project, User } from "../types";
import { Avatar } from "./ui/Avatar";
import { Icon } from "./ui/Icon";
import { ProjectCommits } from "./projects/ProjectCommits";
import { ProjectDigest, ProjectDigestSkeleton } from "./projects/ProjectDigest";
import { Skeleton } from "./ui/Skeleton";
import styles from "./ProjectCard.module.css";

interface Props {
  project: Project;
  /** Shown as a header row when present (feed / preview). */
  owner?: Pick<User, "username" | "displayName" | "avatarUrl"> | null;
  liked?: boolean;
  onToggleLike?: (project: Project) => void;
  actions?: ReactNode;
  /** Lets a `.stagger` parent pass `--i` for the entrance delay. */
  style?: CSSProperties;
  /** Composer preview: no API calls or likes; a public GitHub social image may load. */
  previewMode?: boolean;
}

/** Two more tries after the first failure — 1.5 s, then 3 s. Measured: a busy
 *  opengraph.githubassets.com fails in ~200 ms and serves the same URL fine moments later. */
const SOCIAL_COVER_RETRIES = 2;
const SOCIAL_COVER_RETRY_MS = 1500;

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The post. Screenshots win over GitHub's social cover; extra shots stay tappable.
 * Repo enrichment is optional and never replaces the author's own description.
 */
export function ProjectCard({ project, owner, liked, onToggleLike, actions, style, previewMode }: Props) {
  const images = project.imageUrls.length ? project.imageUrls : project.coverImageUrl ? [project.coverImageUrl] : [];
  const [active, setActive] = useState(0);
  // GitHub renders the social card on first request and fails fast (~200 ms) when it
  // is busy, so one error is not a verdict: remount the <img> a couple of times with a
  // pause before giving up. `attempt` in the key forces the refetch; -1 means "gave up".
  const [socialAttempt, setSocialAttempt] = useState(0);
  const activeIndex = Math.min(active, Math.max(0, images.length - 1));
  const imageCover = images[activeIndex] ?? null;
  const repo = githubRepoOf(project.repoUrl);
  const isGithub = repo !== null;
  const socialCover = images.length === 0 && repo
    ? `https://opengraph.githubassets.com/${encodeURIComponent(project.id)}/${repo.owner}/${repo.repo}`
    : null;
  const cover = imageCover ?? (socialAttempt >= 0 ? socialCover : null);
  const onSocialCoverError = () => {
    if (socialAttempt >= SOCIAL_COVER_RETRIES) {
      setSocialAttempt(-1);
      return;
    }
    window.setTimeout(() => setSocialAttempt((a) => (a >= 0 ? a + 1 : a)), SOCIAL_COVER_RETRY_MS * (socialAttempt + 1));
  };
  const { digest, loading: digestLoading } = useProjectDigest(project.id, project.repoUrl, previewMode);
  const authoredDescription = project.description?.trim();
  const description = authoredDescription || digest?.description?.trim() || clampWords(digest?.readme?.excerpt ?? "");
  // Reads off `createdAt` on first paint and swaps to the repo's last push once the
  // digest lands — same line, same height, so nothing under it moves.
  const updated = updatedLabel(digest?.pushedAt, project.createdAt);

  return (
    <article className={styles.card} style={style}>
      {owner && (
        <div className={styles.owner}>
          <Avatar src={owner.avatarUrl} name={owner.displayName} size={26} />
          <Link to={`/u/${owner.username}`} className={styles.ownerName} onClick={(e) => previewMode && e.preventDefault()}>
            {owner.displayName}
          </Link>
          <span className={styles.ownerHandle}>@{owner.username}</span>
          {!project.isPublic && (
            <span className={styles.privateTag} title="Only you can see this">
              <Icon name="eyeOff" size={12} />
              Private
            </span>
          )}
        </div>
      )}

      {cover && (
        <div className={styles.media}>
          <Link
            to={`/p/${project.id}`}
            onClick={(e) => previewMode && e.preventDefault()}
            aria-label={project.name}
          >
            <img
              key={imageCover ? cover : `${cover}#${socialAttempt}`}
              className={[styles.cover, !imageCover && styles.socialCover].filter(Boolean).join(" ")}
              src={cover}
              alt=""
              loading={previewMode ? "eager" : "lazy"}
              referrerPolicy="no-referrer"
              onError={!imageCover ? onSocialCoverError : undefined}
            />
          </Link>
          {images.length > 1 && (
            <div className={styles.strip} role="tablist" aria-label="Screenshots">
              {images.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  role="tab"
                  aria-label={`Screenshot ${i + 1}`}
                  aria-selected={i === activeIndex}
                  className={[styles.thumb, i === activeIndex && styles.thumbActive].filter(Boolean).join(" ")}
                  onClick={() => setActive(i)}
                >
                  <img src={url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={styles.body}>
        {updated && <span className={styles.updated}>{updated}</span>}
        <h3 className={styles.name}>
          <Link
            to={`/p/${project.id}`}
            className={styles.nameLink}
            onClick={(e) => previewMode && e.preventDefault()}
          >
            {project.name}
          </Link>
        </h3>
        {description && (
          <p
            className={[styles.description, !authoredDescription && styles.repoDescription].filter(Boolean).join(" ")}
            title={!authoredDescription ? "From the repo" : undefined}
          >
            {description}
          </p>
        )}

        {(project.repoUrl || project.liveUrl) && (
          <div className={styles.links}>
            {project.repoUrl && (
              <a href={project.repoUrl} target="_blank" rel="noreferrer" className={styles.link}>
                <Icon name={isGithub ? "github" : "link"} size={14} />
                <span className={styles.linkLabel}>
                  {isGithub
                    ? project.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/$/, "")
                    : hostOf(project.repoUrl)}
                </span>
              </a>
            )}
            {project.liveUrl && (
              <a href={project.liveUrl} target="_blank" rel="noreferrer" className={styles.link}>
                <Icon name="external" size={14} />
                <span className={styles.linkLabel}>{hostOf(project.liveUrl)}</span>
              </a>
            )}
          </div>
        )}

        {digestLoading ? <ProjectDigestSkeleton /> : digest && <ProjectDigest digest={digest} />}
        {isGithub && <ProjectCommits key={project.repoUrl} projectId={project.id} disabled={previewMode} />}

        <div className={styles.footer}>
          <button
            type="button"
            className={[styles.likeBtn, liked && styles.liked].filter(Boolean).join(" ")}
            onClick={() => onToggleLike?.(project)}
            disabled={!onToggleLike || previewMode}
            aria-pressed={!!liked}
            aria-label={liked ? "Unlike" : "Like"}
          >
            <Icon name="heart" size={15} className={styles.heart} />
            {project.likeCount}
          </button>
          {/* No date here any more: `.updated` at the top of the body is the card's
              one timestamp, and it is the better of the two (the repo's last push,
              falling back to this same `createdAt`). */}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      </div>
    </article>
  );
}

/**
 * The card's silhouette while its list loads (skills/emil_design_eng §5). Built from
 * the card's own classes, not from guessed dimensions, so the real post drops into the
 * same box and nothing below it moves.
 */
export function ProjectCardSkeleton({ style }: { style?: CSSProperties }) {
  return (
    <article className={styles.card} style={style} aria-hidden="true">
      <div className={styles.owner}>
        <Skeleton variant="circle" width={26} />
        <Skeleton width={104} height={13} />
      </div>
      <div className={styles.media}>
        {/* The cover's own 16/9 box, inline rather than via `.cover` — that class
            also paints a background and would race Skeleton's own. */}
        <Skeleton variant="block" style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 0 }} />
      </div>
      <div className={styles.body}>
        <Skeleton width={92} height={12} />
        <Skeleton width="68%" height={17} />
        <Skeleton height={13} />
        <Skeleton width="84%" height={13} />
        <div className={styles.links}>
          <Skeleton width={128} height={12} />
        </div>
        <div className={styles.footer}>
          <Skeleton variant="pill" width={46} height={15} />
        </div>
      </div>
    </article>
  );
}
