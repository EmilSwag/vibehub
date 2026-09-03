import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Project, User } from "../types";
import { Avatar } from "./ui/Avatar";
import { Icon } from "./ui/Icon";
import { ProjectCommits } from "./projects/ProjectCommits";
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
  /** Composer preview: no network (commits), no like handler. */
  previewMode?: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The post. Cover = first screenshot; extra shots become a tappable strip that
 * swaps the cover. GitHub repos append a "pushes" strip fetched via our API.
 */
export function ProjectCard({ project, owner, liked, onToggleLike, actions, style, previewMode }: Props) {
  const images = project.imageUrls.length ? project.imageUrls : project.coverImageUrl ? [project.coverImageUrl] : [];
  const [active, setActive] = useState(0);
  const cover = images[Math.min(active, Math.max(0, images.length - 1))] ?? null;
  const isGithub = /^https?:\/\/(www\.)?github\.com\//i.test(project.repoUrl ?? "");

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
            <img key={cover} className={styles.cover} src={cover} alt="" loading="lazy" />
          </Link>
          {images.length > 1 && (
            <div className={styles.strip} role="tablist" aria-label="Screenshots">
              {images.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  className={[styles.thumb, i === active && styles.thumbActive].filter(Boolean).join(" ")}
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
        <h3 className={styles.name}>
          <Link
            to={`/p/${project.id}`}
            className={styles.nameLink}
            onClick={(e) => previewMode && e.preventDefault()}
          >
            {project.name}
          </Link>
        </h3>
        {project.description && <p className={styles.description}>{project.description}</p>}

        {(project.repoUrl || project.liveUrl) && (
          <div className={styles.links}>
            {project.repoUrl && (
              <a href={project.repoUrl} target="_blank" rel="noreferrer" className={styles.link}>
                <Icon name={isGithub ? "github" : "link"} size={14} />
                {isGithub ? project.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/$/, "") : hostOf(project.repoUrl)}
              </a>
            )}
            {project.liveUrl && (
              <a href={project.liveUrl} target="_blank" rel="noreferrer" className={styles.link}>
                <Icon name="external" size={14} />
                {hostOf(project.liveUrl)}
              </a>
            )}
          </div>
        )}

        {isGithub && <ProjectCommits projectId={project.id} disabled={previewMode} />}

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
          <span className={styles.date}>
            {new Date(project.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      </div>
    </article>
  );
}
