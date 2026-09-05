import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { projectsApi } from "../lib/api";
import type { Project, User } from "../types";
import { Avatar } from "../components/ui/Avatar";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/Icon";
import { SectionTitle } from "../components/ui/SectionTitle";
import { Skeleton, SkeletonText } from "../components/ui/Skeleton";
import buttonStyles from "../components/ui/Button.module.css";
import { ProjectGallery } from "../components/projects/ProjectGallery";
import { ProjectCommits } from "../components/projects/ProjectCommits";
import { RepoBrowser } from "../components/projects/RepoBrowser";
import styles from "./ProjectPage.module.css";

interface ProjectData {
  project: Project;
  owner: User;
  liked: boolean;
}

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

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
        <Skeleton variant="pill" width={260} height={38} style={{ marginTop: 20 }} />
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
            className={cx(styles.likeBtn, liked && styles.liked)}
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

        {/* One primary action: go see the thing. The repo is the secondary — its
            contents are already on this page, below. */}
        {(project.liveUrl || project.repoUrl) && (
          <div className={styles.actions}>
            {project.liveUrl && (
              <a
                href={project.liveUrl}
                target="_blank"
                rel="noreferrer"
                className={cx(buttonStyles.btn, buttonStyles.primary)}
              >
                Open site
                <Icon name="external" size={14} />
              </a>
            )}
            {project.repoUrl && (
              <a
                href={project.repoUrl}
                target="_blank"
                rel="noreferrer"
                className={cx(buttonStyles.btn, buttonStyles.secondary)}
              >
                <Icon name={isGithub ? "github" : "link"} size={14} />
                {isGithub ? "GitHub" : hostOf(project.repoUrl)}
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

      {/* The code: languages, README, the file tree — then the pushes, in one card.
          Hidden entirely when the project has no GitHub repo, which leaves the page
          on its title, owner, description and links rather than an empty shell. */}
      {isGithub && project.repoUrl && (
        <section className={styles.section}>
          <SectionTitle icon="folder">Code</SectionTitle>
          <Card className={styles.codeCard}>
            <RepoBrowser projectId={project.id} repoUrl={project.repoUrl} />
            <ProjectCommits projectId={project.id} variant="page" limit={8} />
          </Card>
        </section>
      )}
    </div>
  );
}
