import { Router } from "express";
import { prisma } from "../db";
import { syncAchievements } from "../lib/achievements";
import { asyncHandler, HttpError } from "../lib/http-error";

// Honest achievements — meta/plans/vibehub-honest-achievements-feed.md.
//
// GET /users/:username/achievements → { achievements: Achievement[] }
//   Public, same gate as /users/:username/stats (the user exists → 200). Every read
//   re-evaluates the rules against real rows and persists any badge that just became
//   true (lib/achievements.ts), so the first time anyone looks — the owner's own 60 s
//   poll in practice — is when the unlock moment is recorded and the feed learns of it.

const router = Router();

router.get(
  "/users/:username/achievements",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { username: req.params.username }, select: { id: true } });
    if (!user) throw new HttpError(404, "User not found");
    res.setHeader("Cache-Control", "no-store");
    res.json({ achievements: await syncAchievements(user.id) });
  })
);

export default router;
