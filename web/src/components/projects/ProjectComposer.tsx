import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { projectsApi } from "../../lib/api";
import type { GithubRepoSummary, Project, User } from "../../types";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { FieldLabel, Input, Textarea } from "../ui/Input";
import { ProjectCard } from "../ProjectCard";
import { RepoPicker } from "./RepoPicker";
import styles from "./ProjectComposer.module.css";

export const MAX_IMAGES = 8;

interface Props {
  owner: User;
  /** When set, the composer edits this project instead of creating one. */
  editing?: Project | null;
  onSaved: (project: Project) => void;
  onCancel: () => void;
}

interface FormState {
  name: string;
  description: string;
  repoUrl: string;
  liveUrl: string;
  isPublic: boolean;
}

/**
 * "Write the post, watch the card" — the right column is the exact ProjectCard
 * friends will see, updated on every keystroke. Images are previewed from local
 * object URLs and uploaded after the project row exists.
 */
export function ProjectComposer({ owner, editing, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<FormState>(() => ({
    name: editing?.name ?? "",
    description: editing?.description ?? "",
    repoUrl: editing?.repoUrl ?? "",
    liveUrl: editing?.liveUrl ?? "",
    isPublic: editing?.isPublic ?? true,
  }));
  // Already-hosted screenshots (edit mode) + freshly picked files (both modes).
  const [existingUrls, setExistingUrls] = useState<string[]>(editing?.imageUrls ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const localUrls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => localUrls.forEach((u) => URL.revokeObjectURL(u)), [localUrls]);

  const allImages = [...existingUrls, ...localUrls];
  const slotsLeft = MAX_IMAGES - allImages.length;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Fills the URL and, only where the user hasn't typed anything yet, name/description too.
  function pickRepo(repo: GithubRepoSummary) {
    setForm((prev) => ({
      ...prev,
      repoUrl: repo.htmlUrl,
      name: prev.name.trim() ? prev.name : repo.name,
      description: prev.description.trim() ? prev.description : repo.description ?? prev.description,
    }));
  }

  function pickFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...picked].slice(0, Math.max(0, MAX_IMAGES - existingUrls.length)));
    e.target.value = "";
  }

  function removeImage(index: number) {
    if (index < existingUrls.length) {
      setExistingUrls((prev) => prev.filter((_, i) => i !== index));
    } else {
      const local = index - existingUrls.length;
      setFiles((prev) => prev.filter((_, i) => i !== local));
    }
  }

  // What the card will look like — same component, draft data.
  const preview: Project = {
    id: editing?.id ?? "draft",
    ownerId: owner.id,
    slug: "draft",
    name: form.name.trim() || "Untitled project",
    description: form.description.trim() || null,
    repoUrl: form.repoUrl.trim() || null,
    liveUrl: form.liveUrl.trim() || null,
    coverImageUrl: allImages[0] ?? null,
    imageUrls: allImages,
    isPublic: form.isPublic,
    likeCount: editing?.likeCount ?? 0,
    createdAt: editing?.createdAt ?? new Date().toISOString(),
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        repoUrl: form.repoUrl.trim() || undefined,
        liveUrl: form.liveUrl.trim() || undefined,
        isPublic: form.isPublic,
      };
      let project: Project;
      if (editing) {
        const removed = editing.imageUrls.filter((u) => !existingUrls.includes(u));
        ({ project } = await projectsApi.update(editing.id, {
          name: body.name,
          description: body.description ?? "",
          repoUrl: body.repoUrl ?? "",
          liveUrl: body.liveUrl ?? "",
          isPublic: body.isPublic,
          ...(removed.length ? { imageUrls: existingUrls } : {}),
        }));
      } else {
        ({ project } = await projectsApi.create(body));
      }
      if (files.length > 0) {
        ({ project } = await projectsApi.uploadImages(project.id, files));
      }
      onSaved(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save project");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      <div className={styles.fields}>
        <div>
          <FieldLabel htmlFor="p-name">
            <Icon name="tag" className={styles.labelIcon} />
            Name
          </FieldLabel>
          <Input
            id="p-name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="What did you ship?"
            maxLength={80}
            autoFocus
            required
          />
        </div>

        <div>
          <FieldLabel htmlFor="p-desc">
            <Icon name="text" className={styles.labelIcon} />
            Description
          </FieldLabel>
          <Textarea
            id="p-desc"
            rows={3}
            maxLength={500}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="One or two lines — what it is, what you used."
          />
          <span className={styles.counter}>{form.description.length}/500</span>
        </div>

        <div className={styles.twoUp}>
          <div>
            <div className={styles.labelRow}>
              <FieldLabel htmlFor="p-repo">
                <Icon name="github" className={styles.labelIcon} />
                Repo URL
              </FieldLabel>
              <RepoPicker onPick={pickRepo} />
            </div>
            <Input
              id="p-repo"
              type="url"
              inputMode="url"
              value={form.repoUrl}
              onChange={(e) => set("repoUrl", e.target.value)}
              placeholder="https://github.com/you/project"
            />
            <span className={styles.hint}>GitHub repos show recent pushes on the card.</span>
          </div>
          <div>
            <FieldLabel htmlFor="p-live">
              <Icon name="link" className={styles.labelIcon} />
              Live URL
            </FieldLabel>
            <Input
              id="p-live"
              type="url"
              inputMode="url"
              value={form.liveUrl}
              onChange={(e) => set("liveUrl", e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>

        <div>
          <FieldLabel>
            <Icon name="image" className={styles.labelIcon} />
            Images
            <span className={styles.labelMeta}>
              {allImages.length}/{MAX_IMAGES} · first one is the cover
            </span>
          </FieldLabel>
          <div className={styles.thumbs}>
            {allImages.map((url, i) => (
              <div className={[styles.thumb, i === 0 && styles.thumbCover].filter(Boolean).join(" ")} key={url}>
                <img src={url} alt="" />
                {i === 0 && <span className={styles.coverTag}>Cover</span>}
                <button
                  type="button"
                  className={styles.thumbRemove}
                  onClick={() => removeImage(i)}
                  aria-label="Remove image"
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
            {slotsLeft > 0 && (
              <button
                type="button"
                className={styles.addThumb}
                onClick={() => fileInput.current?.click()}
                aria-label="Add images"
              >
                <Icon name="plus" size={18} />
                <span>Add</span>
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={pickFiles}
          />
        </div>

        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={form.isPublic}
            onChange={(e) => set("isPublic", e.target.checked)}
          />
          <span className={styles.toggleTrack} aria-hidden="true">
            <span className={styles.toggleKnob} />
          </span>
          <Icon name={form.isPublic ? "eye" : "eyeOff"} className={styles.labelIcon} />
          <span>{form.isPublic ? "Visible to everyone" : "Only you can see this"}</span>
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button type="button" className={styles.linkButton} onClick={onCancel}>
            Cancel
          </button>
          <Button type="submit" disabled={saving || !form.name.trim()}>
            {saving
              ? files.length
                ? "Uploading…"
                : "Saving…"
              : editing
                ? "Save changes"
                : "Publish"}
          </Button>
        </div>
      </div>

      <aside className={styles.previewCol} aria-label="Post preview">
        <div className={styles.previewHead}>
          <Icon name="eye" size={14} />
          Preview
          <span className={styles.previewMeta}>how friends will see it</span>
        </div>
        <div className={styles.previewCard}>
          <ProjectCard project={preview} owner={owner} previewMode />
        </div>
      </aside>
    </form>
  );
}
