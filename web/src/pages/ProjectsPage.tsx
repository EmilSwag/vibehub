import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { projectsApi } from "../lib/api";
import { stagger, useExitTransition } from "../lib/motion";
import { arrivalToast, externalArrivals } from "../lib/projectArrivals";
import type { Project } from "../types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ErrorState } from "../components/ui/ErrorState";
import { Icon } from "../components/ui/Icon";
import { ProjectCard, ProjectCardSkeleton } from "../components/ProjectCard";
import { ProjectComposer } from "../components/projects/ProjectComposer";
import { PublishFromAI } from "../components/projects/PublishFromAI";
import styles from "./ProjectsPage.module.css";

export function ProjectsPage() {
  const { user } = useAuth();
  const { pushToast } = useRealtime();
  const [projects, setProjects] = useState<Project[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  /** A failed snapshot is not an empty profile — without this the page tells a user
   *  with posts that they have none (skills/emil_design_eng §5). */
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /** Deleting is destructive and irreversible, so it is confirmed — in-product, not
   *  through the OS dialog `window.confirm` puts on screen. */
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const changedProjectIds = useRef(new Set<string>());
  // Last snapshot's ids, so a later refresh can tell "always been there" apart from
  // "just appeared" — null until the first load resolves. See lib/projectArrivals.ts.
  const knownProjectIds = useRef<Set<string> | null>(null);
  const [composer, setComposer] = useState<{ open: boolean; editing: Project | null }>({
    open: false,
    editing: null,
  });
  // Keeps `editing` around through the close animation so the card doesn't blank
  // out mid-fade — only `open` flips immediately.
  const closeComposer = () => setComposer((c) => ({ ...c, open: false }));
  const { render: renderComposer, closing: composerClosing } = useExitTransition(composer.open, 260);

  useEffect(() => {
    if (!user) return;
    const username = user.username;
    let active = true;

    function refresh() {
      return projectsApi
        .list(username)
        .then(({ projects, likedIds }) => {
          if (!active) return;
          // A slow snapshot can predate a successful publish/edit/delete/like.
          // Keep local changes first, then fill in the untouched older projects.
          const changed = changedProjectIds.current;
          // PublishFromAI posts straight to the API from an external agent — this
          // tab only learns about it here, on the next snapshot. Toast it exactly
          // like a local publish, but only once (never on the first-ever load).
          const arrived = externalArrivals(projects, knownProjectIds.current, changed);
          const toast = arrivalToast(arrived);
          if (toast) pushToast({ ...toast, href: `/u/${username}` });
          knownProjectIds.current = new Set(projects.map((p) => p.id));

          setProjects((prev) => [
            ...prev.filter((project) => changed.has(project.id)),
            ...projects.filter((project) => !changed.has(project.id)),
          ]);
          setLikedIds((prev) => new Set([
            ...likedIds.filter((id) => !changed.has(id)),
            ...[...prev].filter((id) => changed.has(id)),
          ]));
        })
        .catch(() => { if (active) setFailed(true); })
        .finally(() => { if (active) setLoading(false); });
    }

    setLoading(true);
    setFailed(false);
    void refresh();
    // Catches the common case: copy the AI-publish prompt, alt-tab to the agent, come
    // back — the tab regaining visibility is the one moment worth re-checking without
    // polling the whole time it's in the background.
    function onVisible() {
      if (document.visibilityState === "visible") void refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, pushToast, attempt]);

  // Retry drops the grid back to its skeleton, so recovery looks like a first load.
  const retry = () => setAttempt((n) => n + 1);

  function saved(project: Project) {
    changedProjectIds.current.add(project.id);
    setLoading(false);
    setFailed(false);
    setProjects((prev) => {
      const exists = prev.some((p) => p.id === project.id);
      return exists ? prev.map((p) => (p.id === project.id ? project : p)) : [project, ...prev];
    });
    closeComposer();
    pushToast({
      title: composer.editing ? "Project updated" : "Published",
      body: composer.editing ? project.name : `${project.name} is now on your profile.`,
      href: `/u/${user?.username ?? ""}`,
    });
  }

  async function remove(project: Project) {
    try {
      await projectsApi.remove(project.id);
      changedProjectIds.current.add(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      setPendingDelete(null);
    } catch {
      pushToast({ title: "Couldn't delete", body: `${project.name} is still there.` });
    }
  }

  async function toggleLike(project: Project) {
    const liked = likedIds.has(project.id);
    const { likeCount } = liked ? await projectsApi.unlike(project.id) : await projectsApi.like(project.id);
    changedProjectIds.current.add(project.id);
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
          <p className={styles.lead}>What friends see on your profile.</p>
        </div>
        {!composer.open && (
          <Button onClick={() => setComposer({ open: true, editing: null })}>
            <Icon name="plus" size={15} />
            New post
          </Button>
        )}
      </div>

      {renderComposer && (
        <Card className={[styles.composerCard, composerClosing ? "leave" : "reveal"].join(" ")}>
          <div className={styles.composerHead}>
            <Icon name={composer.editing ? "text" : "sparkles"} size={15} />
            {composer.editing ? "Edit post" : "New post"}
          </div>
          <ProjectComposer
            key={composer.editing?.id ?? "new"}
            owner={user}
            editing={composer.editing}
            onSaved={saved}
            onCancel={closeComposer}
          />
        </Card>
      )}

      <div className={styles.aiCard}>
        <PublishFromAI />
      </div>

      {loading ? (
        <div className={styles.grid}>
          {Array.from({ length: 3 }, (_, i) => (
            <ProjectCardSkeleton key={i} style={stagger(i)} />
          ))}
        </div>
      ) : failed && projects.length === 0 ? (
        /* Only when there is nothing else to show. `refresh` also runs when the tab
           regains visibility, and a transient failure there must not replace posts
           the user is already looking at with an error. */
        <Card className={styles.empty}>
          <ErrorState onRetry={retry}>Couldn't load your posts.</ErrorState>
        </Card>
      ) : projects.length === 0 ? (
        <Card className={styles.empty}>
          <Icon name="image" size={22} />
          <p>No posts yet — hit “New post”, or let your AI publish one.</p>
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
                    onClick={() => setPendingDelete(project)}
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

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete “${pendingDelete.name}”?` : "Delete post?"}
        body="This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => (pendingDelete ? remove(pendingDelete) : undefined)}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
