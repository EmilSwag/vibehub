import { Router } from "express";
import { prisma } from "../db";
import { friendIdsOf } from "../lib/friends";
import { asyncHandler } from "../lib/http-error";
import { presenceFor } from "../lib/sessions";
import { requireAuth } from "../middleware/auth";

// Initial presence snapshot for the friends list — ARCHITECTURE.md §5.7. Live updates
// after this arrive over the WebSocket `presence` channel (§5.9). Presence is only ever
// exposed to accepted friends (§3) — plus the requester's own row, so their own status
// renders without a second endpoint.

const router = Router();

router.get(
  "/presence/friends",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const ids = [me.id, ...(await friendIdsOf(me.id))];
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } });

    const presences = await Promise.all(users.map((u) => presenceFor(u.id, u.username)));
    res.json({ presences });
  })
);

export default router;
