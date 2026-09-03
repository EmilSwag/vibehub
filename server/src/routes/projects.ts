import { Router } from "express";
import { prisma } from "../db";
import { asyncHandler, HttpError } from "../lib/http-error";
import { createProjectSchema, patchProjectSchema } from "../lib/schemas";
import { toPublicProject } from "../lib/serializers";
import { optionalAuth, requireAuth } from "../middleware/auth";

// Project cards + likes — ARCHITECTURE.md §5.5. `likeCount` is denormalized and updated
// in the same transaction as the Like row (§2.7) — no reconciliation job.

const router = Router();

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
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const data = createProjectSchema.parse(req.body);
    const project = await prisma.project.create({
      data: { ...data, ownerId: me.id, slug: await uniqueSlug(me.id, data.name) },
    });
    res.status(201).json({ project: toPublicProject(project) });
  })
);

router.patch(
  "/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const data = patchProjectSchema.parse(req.body);
    const existing = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.ownerId !== me.id) throw new HttpError(404, "Project not found");

    const project = await prisma.project.update({ where: { id: existing.id }, data });
    res.json({ project: toPublicProject(project) });
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
