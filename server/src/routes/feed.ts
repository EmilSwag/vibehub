import { Router } from "express";
import { prisma } from "../db";
import { feedQuerySchema, feedReactionSchema, listFeed, toggleReaction } from "../lib/feed";
import { friendIdsOf } from "../lib/friends";
import { asyncHandler, HttpError } from "../lib/http-error";
import { optionalAuth, requireAuth } from "../middleware/auth";

// Vibe Feed — meta/plans/vibehub-honest-achievements-feed.md, "Contract" → REST.
//
//   GET  /feed?limit=30&before=<ISO>            auth;   self + accepted friends
//   GET  /users/:username/feed?limit=&before=   public; that user's own events only
//                                               (mine = all false when signed out)
//     → { events: FeedEvent[], nextBefore: string|null }
//   POST /feed/reactions { target, kind }       auth;   toggles → { target, kind, active, count }
//
// Shaping and the row queries live in lib/feed.ts; these handlers only decide scope and
// viewer. Presence stays friends-only elsewhere (§3): the public profile feed lists what
// that person already shows on their profile — finished sessions, badges, public
// projects, commit days, friendships — never a stranger's live activity beyond that.

const router = Router();

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
    const user = await prisma.user.findUnique({ where: { username: req.params.username }, select: { id: true } });
    if (!user) throw new HttpError(404, "User not found");
    res.setHeader("Cache-Control", "no-store");
    res.json(await listFeed([user.id], req.user?.id ?? null, query));
  })
);

router.post(
  "/feed/reactions",
  requireAuth,
  asyncHandler(async (req, res) => {
    // The regex is the whole gate: a target that matches but names nothing merely holds
    // a count nobody will ever read, which is cheaper than an existence query per tap.
    const { target, kind } = feedReactionSchema.parse(req.body);
    res.json(await toggleReaction(req.user!.id, target, kind));
  })
);

export default router;
