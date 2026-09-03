import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { projectsApi } from "../lib/api";
import type { Project, User } from "../types";
import { Avatar } from "../components/ui/Avatar";
import { Icon } from "../components/ui/Icon";
import { Skeleton, SkeletonText } from "../components/ui/Skeleton";
import { ProjectGallery } from "../components/projects/ProjectGallery";
import { ProjectCommits } from "../components/projects/ProjectCommits";
import styles from "./ProjectPage.module.css";

interface ProjectData {
  project: Project;
  owner: User;
  liked: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ProjectPage() {
  const { id = "" } = useParams();
  const { user: me } = useAuth();
  const [data, setData] = useState<ProjectData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);

  useEffect(() => {
    setData(null);
    setNotFound(false);
    projectsApi
      .get(id)
      .then((res) => {
        setData(res);
        setLiked(res.liked);
        setLikeCount(res.project.likeCount);
      })
      .catch(() => setNotFound(true));
  }, [id]);

  async function toggleLike() {
    if (!data || !me) return;
    const result = liked ? await projectsApi.unlike(data.project.id) : await projectsApi.like(data.project.id);
    setLiked(!liked);
    setLikeCount(result.likeCount);
  }

  if (notFound) {
    return <p className={styles.empty}>This project doesn't exist, or isn't public.</p>;
  }

  if (!data) {
    return (
      <div>
        <Skeleton width={90} height={13} style={{ marginBottom: 20 }} />
        <div className={styles.owner}>
          <Skeleton variant="circle" width={26} />
          <Skeleton width={120} height={13} />
        </div>
        <Skeleton width={280} height={30} style={{ margin: "10px 0" }} />
        <SkeletonText lines={2} />
        <Skeleton variant="block" height={340} style={{ marginTop: 20 }} />
      </div>
    );
  }

  const { project, owner } = data;
  const isGithub = /^https?:\/\/(www\.)?github\.com\//i.test(project.repoUrl ?? "");
  const images = project.imageUrls.length ? project.imageUrls : project.coverImageUrl ? [project.coverImageUrl] : [];

  return (
    <div className="reveal">
      <Link to={`/u/${owner.username}`} className={styles.back}>
        <Icon name="arrowLeft" size={14} />
        Back to profile
      </Link>

      <div className={styles.head}>
        <div className={styles.owner}>
          <Avatar src={owner.avatarUrl} name={owner.displayName} size={26} />
          <Link to={`/u/${owner.username}`} className={styles.ownerName}>
            {owner.displayName}
          </Link>
          <span className={styles.ownerHandle}>@{owner.username}</span>
          {!project.isPublic && (
            <span className={styles.privateTag}>
              <Icon name="eyeOff" size={12} />
              Private
            </span>
          )}
        </div>

        <div className={styles.titleRow}>
          <h1 className={styles.title}>{project.name}</h1>
          <button
            type="button"
            className={[styles.likeBtn, liked && styles.liked].filter(Boolean).join(" ")}
            onClick={toggleLike}
            disabled={!me}
            aria-pressed={liked}
            aria-label={liked ? "Unlike" : "Like"}
          >
            <Icon name="heart" size={16} className={styles.heart} />
            {likeCount}
          </button>
        </div>

        {project.description && <p className={styles.description}>{project.description}</p>}

        {(project.repoUrl || project.liveUrl) && (
          <div className={styles.links}>
            {project.repoUrl && (
              <a href={project.repoUrl} target="_blank" rel="noreferrer" className={styles.link}>
                <Icon name={isGithub ? "github" : "link"} size={14} />
                {isGithub
                  ? project.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/$/, "")
                  : hostOf(project.repoUrl)}
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
      </div>

      {images.length > 0 && (
        <div className={styles.section}>
          <ProjectGallery images={images} alt={project.name} />
        </div>
      )}

      {isGithub && (
        <div className={styles.section}>
          <ProjectCommits projectId={project.id} variant="page" limit={8} />
        </div>
      )}
    </div>
  );
}
