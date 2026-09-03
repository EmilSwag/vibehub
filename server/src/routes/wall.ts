import type { User, WallComment } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../db";
import { areFriends } from "../lib/friends";
import { asyncHandler, HttpError } from "../lib/http-error";
import { wallBodySchema } from "../lib/schemas";
import { toPublicUser } from "../lib/serializers";
import { requireAuth } from "../middleware/auth";
import { emitWallComment } from "../ws/hub";

// Profile wall — ARCHITECTURE.md §5.4. Cursor pagination is keyed on the comment id
// (cuid, monotonic enough for "load more" ordering by createdAt desc). Deletes are
// soft (§2.5) and never shown again.

const router = Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function toPublicComment(comment: WallComment & { author?: User }) {
  return {
    id: comment.id,
    wallOwnerId: comment.wallOwnerId,
    authorId: comment.authorId,
    author: comment.author ? toPublicUser(comment.author) : undefined,
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

router.get(
  "/users/:username/wall",
  asyncHandler(async (req, res) => {
    const owner = await prisma.user.findUnique({ where: { username: req.params.username } });
    if (!owner) throw new HttpError(404, "User not found");

    const limitRaw = Number(req.query.limit ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), MAX_LIMIT) : DEFAULT_LIMIT;
    const cursor = typeof req.query.cursor === "string" && req.query.cursor ? req.query.cursor : undefined;

    const rows = await prisma.wallComment.findMany({
      where: { wallOwnerId: owner.id, deletedAt: null },
      include: { author: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    res.json({
      comments: page.map(toPublicComment),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  })
);

router.post(
  "/users/:username/wall",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const { body } = wallBodySchema.parse(req.body);

    const owner = await prisma.user.findUnique({ where: { username: req.params.username } });
    if (!owner) throw new HttpError(404, "User not found");
    if (!(await areFriends(me.id, owner.id))) {
      throw new HttpError(403, "Only friends can write on this wall");
    }

    const comment = await prisma.wallComment.create({
      data: { wallOwnerId: owner.id, authorId: me.id, body },
      include: { author: true },
    });

    const publicComment = toPublicComment(comment);
    emitWallComment(owner.username, publicComment);
    res.status(201).json({ comment: publicComment });
  })
);

router.delete(
  "/wall/:commentId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const comment = await prisma.wallComment.findUnique({ where: { id: req.params.commentId } });
    if (!comment || comment.deletedAt) throw new HttpError(404, "Comment not found");
    if (comment.authorId !== me.id && comment.wallOwnerId !== me.id) {
      throw new HttpError(403, "Only the author or the wall owner can delete this comment");
    }

    await prisma.wallComment.update({ where: { id: comment.id }, data: { deletedAt: new Date() } });
    res.status(204).end();
  })
);

export default router;
