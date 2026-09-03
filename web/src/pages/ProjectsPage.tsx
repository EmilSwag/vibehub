import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { projectsApi } from "../lib/api";
import { stagger } from "../lib/motion";
import type { Project } from "../types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Skeleton } from "../components/ui/Skeleton";
import { ProjectCard } from "../components/ProjectCard";
import { ProjectComposer } from "../components/projects/ProjectComposer";
import { PublishFromAI } from "../components/projects/PublishFromAI";
import styles from "./ProjectsPage.module.css";

export function ProjectsPage() {
  const { user } = useAuth();
  const { pushToast } = useRealtime();
  const [projects, setProjects] = useState<Project[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState<{ open: boolean; editing: Project | null }>({
    open: false,
    editing: null,
  });

  useEffect(() => {
    if (!user) return;
    projectsApi
      .list(user.username)
      .then(({ projects, likedIds }) => {
        setProjects(projects);
        setLikedIds(new Set(likedIds));
      })
      .finally(() => setLoading(false));
  }, [user]);

  function saved(project: Project) {
    setProjects((prev) => {
      const exists = prev.some((p) => p.id === project.id);
      return exists ? prev.map((p) => (p.id === project.id ? project : p)) : [project, ...prev];
    });
    setComposer({ open: false, editing: null });
    pushToast({
      title: composer.editing ? "Project updated" : "Published",
      body: composer.editing ? project.name : `${project.name} is now on your profile.`,
      href: `/u/${user?.username ?? ""}`,
    });
  }

  async function remove(project: Project) {
    if (!window.confirm(`Delete “${project.name}”? This can't be undone.`)) return;
    await projectsApi.remove(project.id);
    setProjects((prev) => prev.filter((p) => p.id !== project.id));
  }

  async function toggleLike(project: Project) {
    const liked = likedIds.has(project.id);
    const { likeCount } = liked ? await projectsApi.unlike(project.id) : await projectsApi.like(project.id);
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (liked) next.delete(project.id);
      else next.add(project.id);
      return next;
    });
    setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, likeCount } : p)));
  }

  if (!user) return null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Your projects</h1>
          <p className={styles.lead}>Posts your friends see on your profile and in their feed.</p>
        </div>
        {!composer.open && (
          <Button onClick={() => setComposer({ open: true, editing: null })}>
            <Icon name="plus" size={15} />
            New post
          </Button>
        )}
      </div>

      {composer.open && (
        <Card className={styles.composerCard}>
          <div className={styles.composerHead}>
            <Icon name={composer.editing ? "text" : "sparkles"} size={15} />
            {composer.editing ? "Edit post" : "New post"}
          </div>
          <ProjectComposer
            key={composer.editing?.id ?? "new"}
            owner={user}
            editing={composer.editing}
            onSaved={saved}
            onCancel={() => setComposer({ open: false, editing: null })}
          />
        </Card>
      )}

      <div className={styles.aiCard}>
        <PublishFromAI />
      </div>

      {loading ? (
        <div className={styles.grid}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} variant="block" height={220} style={stagger(i)} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <Card className={styles.empty}>
          <Icon name="image" size={22} />
          <p>No posts yet. Ship something, then hit “New post” — or let your AI publish it for you.</p>
        </Card>
      ) : (
        <div className={[styles.grid, "stagger"].join(" ")}>
          {projects.map((project, i) => (
            <ProjectCard
              key={project.id}
              project={project}
              owner={user}
              liked={likedIds.has(project.id)}
              onToggleLike={toggleLike}
              style={stagger(i)}
              actions={
                <>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => setComposer({ open: true, editing: project })}
                    aria-label="Edit"
                    title="Edit"
                  >
                    <Icon name="text" size={15} />
                  </button>
                  <button
                    type="button"
                    className={[styles.iconBtn, styles.iconBtnDanger].join(" ")}
                    onClick={() => remove(project)}
                    aria-label="Delete"
                    title="Delete"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
