import type { ReactNode } from "react";
import type { Project } from "../types";
import styles from "./ProjectCard.module.css";

export function ProjectCard({
  project,
  liked,
  onToggleLike,
  actions,
}: {
  project: Project;
  liked?: boolean;
  onToggleLike?: (project: Project) => void;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.card}>
      {project.coverImageUrl && <img className={styles.cover} src={project.coverImageUrl} alt="" />}
      <div className={styles.body}>
        <h3 className={styles.name}>{project.name}</h3>
        {project.description && <p className={styles.description}>{project.description}</p>}
        <div className={styles.links}>
          {project.repoUrl && (
            <a href={project.repoUrl} target="_blank" rel="noreferrer">
              Repo
            </a>
          )}
          {project.liveUrl && (
            <a href={project.liveUrl} target="_blank" rel="noreferrer">
              Live
            </a>
          )}
        </div>
        <div className={styles.footer}>
          <button
            type="button"
            className={[styles.likeBtn, liked && styles.liked].filter(Boolean).join(" ")}
            onClick={() => onToggleLike?.(project)}
            disabled={!onToggleLike}
          >
            ♥ {project.likeCount}
          </button>
          {actions}
        </div>
      </div>
    </div>
  );
}
