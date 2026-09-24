import { Router } from "express";
import { z } from "zod";
import {
  createPost,
  deletePost,
  feedQuerySchema,
  feedReactionSchema,
  listFeed,
  listUserPosts,
  recordPostView,
  toggleReaction,
} from "../lib/feed";
import { friendIdsOf } from "../lib/friends";
import { asyncHandler } from "../lib/http-error";
import { optionalAuth, requireAuth } from "../middleware/auth";

// Vibe Feed — posts-only feed (meta/plans/vibehub-round21-feed-posts-polish.md).
//
//   GET    /feed                                auth;   mine + friends + suggested posts (~1 in 4)
//   GET    /users/:username/feed                public; that user's own posts only
//   POST   /feed/reactions { target, kind }     auth;   toggles (like, respect, flame)
//   POST   /posts { content }                   auth;   creates a post
//   DELETE /posts/:id                           auth;   deletes own post
//   POST   /posts/:id/view { viewerKey? }       opt;    tracks unique on-screen view (never author)

const router = Router();

const postCreateSchema = z.object({
  content: z.string().trim().min(1, "Post cannot be empty").max(2000, "Post too long"),
});

const postViewSchema = z.object({
  viewerKey: z.string().trim().min(1).max(120).optional(),
});

router.get(
  "/feed",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const query = feedQuerySchema.parse(req.query);
    const friendIds = await friendIdsOf(me.id);
    res.setHeader("Cache-Control", "no-store");
    res.json(await listFeed([me.id, ...friendIds], me.id, query));
  })
);

router.get(
  "/users/:username/feed",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const query = feedQuerySchema.parse(req.query);
    res.setHeader("Cache-Control", "no-store");
    res.json(await listUserPosts(req.params.username, req.user?.id ?? null, query));
  })
);

router.post(
  "/feed/reactions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { target, kind } = feedReactionSchema.parse(req.body);
    res.json(await toggleReaction(req.user!.id, target, kind));
  })
);

router.post(
  "/posts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { content } = postCreateSchema.parse(req.body);
    const post = await createPost(req.user!.id, content);
    res.status(201).json({ post });
  })
);

router.delete(
  "/posts/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    await deletePost(req.params.id, req.user!.id);
    res.status(204).end();
  })
);

router.post(
  "/posts/:id/view",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const body = postViewSchema.parse(req.body || {});
    const viewerId = req.user?.id ?? null;
    const viewerKey = viewerId
      ? `u:${viewerId}`
      : body.viewerKey
      ? `k:${body.viewerKey}`
      : `anon:${req.ip || "unknown"}`;
    const result = await recordPostView(req.params.id, viewerId, viewerKey);
    res.json(result);
  })
);

export default router;
