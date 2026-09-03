import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { env } from "../env";
import { decryptGithubToken, fetchRepoActivity, parseGithubRepoUrl } from "../lib/github";
import { asyncHandler, HttpError } from "../lib/http-error";
import {
  createProjectSchema,
  imageUrlsFromJson,
  imageUrlsToJson,
  MAX_PROJECT_IMAGES,
  patchProjectSchema,
} from "../lib/schemas";
import { toPublicProject, toPublicUser } from "../lib/serializers";
import { optionalAuth, requireAuth, requireUserOrToken } from "../middleware/auth";

// Project cards + likes — ARCHITECTURE.md §5.5. `likeCount` is denormalized and updated
// in the same transaction as the Like row (§2.7) — no reconciliation job.
//
// Write endpoints accept a session cookie OR a Bearer device token, so an AI
// agent (Claude Code, Codex…) can publish straight from the repo — see the
// "Publish from AI" card in the web for the exact prompt.

const router = Router();

// Screenshots live next to avatars on the persistent volume; served under /uploads.
const PROJECT_IMAGE_DIR = path.join(env.uploadDir, "projects");
fs.mkdirSync(PROJECT_IMAGE_DIR, { recursive: true });

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: PROJECT_IMAGE_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".png";
      cb(null, `${req.user!.id}-${crypto.randomBytes(6).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: MAX_PROJECT_IMAGES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new HttpError(400, "Files must be images"));
      return;
    }
    cb(null, true);
  },
});

/** Best-effort delete of screenshot files we wrote ourselves (never foreign URLs). */
function removeOwnProjectImages(urls: readonly string[]): void {
  const prefix = "/uploads/projects/";
  for (const url of urls) {
    let pathname: string;
    try {
      pathname = url.startsWith("/") ? url : new URL(url).pathname;
    } catch {
      continue;
    }
    if (!pathname.startsWith(prefix)) continue;
    const filename = path.basename(pathname);
    if (!filename || filename !== pathname.slice(prefix.length)) continue;
    fs.rm(path.join(PROJECT_IMAGE_DIR, filename), { force: true }, () => undefined);
  }
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "project";
}

async function uniqueSlug(ownerId: string, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.project.findUnique({ where: { ownerId_slug: { ownerId, slug: candidate } } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

router.get(
  "/users/:username/projects",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const owner = await prisma.user.findUnique({ where: { username: req.params.username } });
    if (!owner) throw new HttpError(404, "User not found");

    // Owners see their private cards too; everyone else only public ones.
    const isOwner = req.user?.id === owner.id;
    const projects = await prisma.project.findMany({
      where: { ownerId: owner.id, ...(isOwner ? {} : { isPublic: true }) },
      orderBy: { createdAt: "desc" },
    });

    // Which of these the viewer already liked — lets the web client render the
    // toggled state without N extra round-trips. Additive to the §5.5 shape.
    let likedIds: string[] = [];
    if (req.user && projects.length > 0) {
      const likes = await prisma.like.findMany({
        where: { userId: req.user.id, projectId: { in: projects.map((p) => p.id) } },
        select: { projectId: true },
      });
      likedIds = likes.map((l) => l.projectId);
    }

    res.json({ projects: projects.map(toPublicProject), likedIds });
  })
);

router.post(
  "/projects",
  requireUserOrToken,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const { imageUrls, ...data } = createProjectSchema.parse(req.body);
    const project = await prisma.project.create({
      data: {
        ...data,
        // First screenshot doubles as the cover unless one was given explicitly.
        coverImageUrl: data.coverImageUrl ?? imageUrls?.[0] ?? null,
        imageUrls: imageUrls ? imageUrlsToJson(imageUrls) : null,
        ownerId: me.id,
        slug: await uniqueSlug(me.id, data.name),
      },
    });
    res.status(201).json({ project: toPublicProject(project) });
  })
);

router.patch(
  "/projects/:id",
  requireUserOrToken,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const { imageUrls, ...data } = patchProjectSchema.parse(req.body);
    const existing = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.ownerId !== me.id) throw new HttpError(404, "Project not found");

    const project = await prisma.project.update({
      where: { id: existing.id },
      data: { ...data, ...(imageUrls ? { imageUrls: imageUrlsToJson(imageUrls) } : {}) },
    });
    // Screenshots dropped from the list → delete the files we host.
    if (imageUrls) {
      const kept = new Set(imageUrls);
      removeOwnProjectImages(imageUrlsFromJson(existing.imageUrls).filter((u) => !kept.has(u)));
    }
    res.json({ project: toPublicProject(project) });
  })
);

/**
 * Multipart upload of up to 8 screenshots (field `files`). Appends to the
 * project's list; the first image ever uploaded becomes the cover.
 */
router.post(
  "/projects/:id/images",
  requireUserOrToken,
  imageUpload.array("files", MAX_PROJECT_IMAGES),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const existing = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.ownerId !== me.id) throw new HttpError(404, "Project not found");
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw new HttpError(400, "No files");

    const base = `${req.protocol}://${req.get("host")}/uploads/projects/`;
    const current = imageUrlsFromJson(existing.imageUrls);
    const added = files.map((f) => base + f.filename);
    const next = [...current, ...added].slice(0, MAX_PROJECT_IMAGES);
    if (next.length < current.length + added.length) {
      // Over the cap — drop the extra files we just wrote.
      removeOwnProjectImages([...current, ...added].slice(MAX_PROJECT_IMAGES));
    }

    const project = await prisma.project.update({
      where: { id: existing.id },
      data: { imageUrls: imageUrlsToJson(next), coverImageUrl: existing.coverImageUrl ?? next[0] ?? null },
    });
    res.json({ project: toPublicProject(project) });
  })
);

/**
 * Project detail — round 5. Public if `isPublic`; the owner can always see their
 * own (including private) projects. `liked` reflects the viewer, `false` when
 * signed out — mirrors the `likedIds` pattern on the list endpoint (§5.5).
 */
router.get(
  "/projects/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { owner: true },
    });
    if (!project || (!project.isPublic && project.ownerId !== req.user?.id)) {
      throw new HttpError(404, "Project not found");
    }

    let liked = false;
    if (req.user) {
      const like = await prisma.like.findUnique({
        where: { projectId_userId: { projectId: project.id, userId: req.user.id } },
      });
      liked = Boolean(like);
    }

    res.json({ project: toPublicProject(project), owner: toPublicUser(project.owner), liked });
  })
);

/**
 * Recent pushes for the linked GitHub repo (owner's decrypted OAuth token when we
 * have it, so private repos work for their owner), plus per-commit line stats,
 * latest CI run, and latest release (round 5). Empty/null fields when the URL
 * isn't GitHub or GitHub can't be reached — the card still renders either way.
 */
router.get(
  "/projects/:id/commits",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { owner: { select: { githubAccessToken: true } } },
    });
    if (!project || (!project.isPublic && project.ownerId !== req.user?.id)) {
      throw new HttpError(404, "Project not found");
    }
    const ref = parseGithubRepoUrl(project.repoUrl);
    if (!ref) {
      res.json({ repo: null, commits: [], lastPushAt: null, build: null, latestRelease: null });
      return;
    }
    try {
      const token = decryptGithubToken(project.owner.githubAccessToken);
      const activity = await fetchRepoActivity(ref, token, 30);
      res.json(activity);
    } catch {
      // GitHub hiccup — the card still renders, just without the push list.
      res.json({ repo: ref, commits: [], lastPushAt: null, fetchedAt: new Date().toISOString(), build: null, latestRelease: null });
    }
  })
);

router.delete(
  "/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const existing = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.ownerId !== me.id) throw new HttpError(404, "Project not found");

    await prisma.project.delete({ where: { id: existing.id } });
    removeOwnProjectImages([...imageUrlsFromJson(existing.imageUrls), ...(existing.coverImageUrl ? [existing.coverImageUrl] : [])]);
    res.status(204).end();
  })
);

router.post(
  "/projects/:id/like",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project || (!project.isPublic && project.ownerId !== me.id)) {
      throw new HttpError(404, "Project not found");
    }

    const already = await prisma.like.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: me.id } },
    });
    if (already) {
      res.json({ likeCount: project.likeCount });
      return;
    }

    const [, updated] = await prisma.$transaction([
      prisma.like.create({ data: { projectId: project.id, userId: me.id } }),
      prisma.project.update({ where: { id: project.id }, data: { likeCount: { increment: 1 } } }),
    ]);
    res.json({ likeCount: updated.likeCount });
  })
);

router.delete(
  "/projects/:id/like",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) throw new HttpError(404, "Project not found");

    const existing = await prisma.like.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: me.id } },
    });
    if (!existing) {
      res.json({ likeCount: project.likeCount });
      return;
    }

    const [, updated] = await prisma.$transaction([
      prisma.like.delete({ where: { id: existing.id } }),
      prisma.project.update({
        where: { id: project.id },
        data: { likeCount: { decrement: project.likeCount > 0 ? 1 : 0 } },
      }),
    ]);
    res.json({ likeCount: updated.likeCount });
  })
);

export default router;
