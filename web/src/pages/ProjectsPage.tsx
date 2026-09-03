import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { projectsApi } from "../lib/api";
import type { Project } from "../types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { FieldLabel, Input, Textarea } from "../components/ui/Input";
import { Skeleton } from "../components/ui/Skeleton";
import { ProjectCard } from "../components/ProjectCard";
import styles from "./ProjectsPage.module.css";

const EMPTY_FORM = { name: "", description: "", repoUrl: "", liveUrl: "" };

export function ProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    projectsApi
      .list(user.username)
      .then(({ projects }) => setProjects(projects))
      .finally(() => setLoading(false));
  }, [user]);

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function startEdit(project: Project) {
    setEditingId(project.id);
    setForm({
      name: project.name,
      description: project.description ?? "",
      repoUrl: project.repoUrl ?? "",
      liveUrl: project.liveUrl ?? "",
    });
    setShowForm(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const { project } = await projectsApi.update(editingId, form);
        setProjects((prev) => prev.map((p) => (p.id === editingId ? project : p)));
      } else {
        const { project } = await projectsApi.create(form);
        setProjects((prev) => [project, ...prev]);
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save project");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await projectsApi.remove(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Your projects</h1>
        <Button onClick={() => (showForm ? setShowForm(false) : startCreate())}>
          {showForm ? "Cancel" : "New project"}
        </Button>
      </div>

      {showForm && (
        <Card style={{ marginBottom: 24 }}>
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.formFull}>
              <FieldLabel htmlFor="p-name">Name</FieldLabel>
              <Input
                id="p-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className={styles.formFull}>
              <FieldLabel htmlFor="p-desc">Description</FieldLabel>
              <Textarea
                id="p-desc"
                rows={2}
                maxLength={500}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel htmlFor="p-repo">Repo URL</FieldLabel>
              <Input
                id="p-repo"
                value={form.repoUrl}
                onChange={(e) => setForm({ ...form, repoUrl: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel htmlFor="p-live">Live URL</FieldLabel>
              <Input
                id="p-live"
                value={form.liveUrl}
                onChange={(e) => setForm({ ...form, liveUrl: e.target.value })}
              />
            </div>
            {error && <span className={styles.formFull} style={{ color: "var(--vh-accent-hover)", fontSize: 13 }}>{error}</span>}
            <div className={styles.formActions}>
              <Button type="submit" disabled={saving || !form.name.trim()}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Create project"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <div className={styles.grid}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} variant="block" height={140} style={{ "--i": i } as CSSProperties} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <p className={styles.empty}>No projects yet — create your first one above.</p>
      ) : (
        <div className={[styles.grid, "stagger"].join(" ")}>
          {projects.map((project, i) => (
            <ProjectCard
              key={project.id}
              project={project}
              style={{ "--i": i } as CSSProperties}
              actions={
                <div className={styles.rowActions}>
                  <button type="button" className={styles.iconBtn} onClick={() => startEdit(project)}>
                    edit
                  </button>
                  <button type="button" className={styles.iconBtn} onClick={() => handleDelete(project.id)}>
                    delete
                  </button>
                </div>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
