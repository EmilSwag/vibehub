import type { FriendRequest, User } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../db";
import { areFriends, daysBetween, orderPair } from "../lib/friends";
import { asyncHandler, HttpError } from "../lib/http-error";
import { sendFriendRequestSchema } from "../lib/schemas";
import { toPublicUser } from "../lib/serializers";
import { requireAuth } from "../middleware/auth";
import { emitFriendRequest } from "../ws/hub";

// Friends & friend requests — ARCHITECTURE.md §5.3. Every route requires the browser
// session cookie. Friendship rows are symmetric and stored once (§2.4, lib/friends.ts).

const router = Router();

type RequestWithUsers = FriendRequest & { sender?: User; receiver?: User };

function toPublicRequest(request: RequestWithUsers) {
  return {
    id: request.id,
    senderId: request.senderId,
    receiverId: request.receiverId,
    status: request.status,
    createdAt: request.createdAt,
    respondedAt: request.respondedAt,
    sender: request.sender ? toPublicUser(request.sender) : undefined,
    receiver: request.receiver ? toPublicUser(request.receiver) : undefined,
  };
}

router.get(
  "/friends",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const rows = await prisma.friendship.findMany({
      where: { OR: [{ userAId: me.id }, { userBId: me.id }] },
      include: { userA: true, userB: true },
      orderBy: { since: "asc" },
    });

    res.json({
      friends: rows.map((row) => {
        const other = row.userAId === me.id ? row.userB : row.userA;
        return { user: toPublicUser(other), since: row.since, daysAsFriends: daysBetween(row.since) };
      }),
    });
  })
);

router.get(
  "/friends/requests",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const [incoming, outgoing] = await Promise.all([
      prisma.friendRequest.findMany({
        where: { receiverId: me.id, status: "PENDING" },
        include: { sender: true, receiver: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.friendRequest.findMany({
        where: { senderId: me.id, status: "PENDING" },
        include: { sender: true, receiver: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    res.json({ incoming: incoming.map(toPublicRequest), outgoing: outgoing.map(toPublicRequest) });
  })
);

router.post(
  "/friends/requests",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const { targetUsername } = sendFriendRequestSchema.parse(req.body);

    const target = await prisma.user.findUnique({ where: { username: targetUsername } });
    if (!target) throw new HttpError(404, "User not found");
    if (target.id === me.id) throw new HttpError(400, "You cannot add yourself");
    if (await areFriends(me.id, target.id)) throw new HttpError(409, "Already friends");

    const existing = await prisma.friendRequest.findFirst({
      where: { senderId: me.id, receiverId: target.id, status: "PENDING" },
    });
    if (existing) throw new HttpError(409, "Request already pending");

    // If they already asked us, treat this as an accept instead of a duplicate request.
    const reverse = await prisma.friendRequest.findFirst({
      where: { senderId: target.id, receiverId: me.id, status: "PENDING" },
    });
    if (reverse) {
      const now = new Date();
      const [accepted] = await prisma.$transaction([
        prisma.friendRequest.update({
          where: { id: reverse.id },
          data: { status: "ACCEPTED", respondedAt: now },
          include: { sender: true, receiver: true },
        }),
        prisma.friendship.create({ data: orderPair(me.id, target.id) }),
      ]);
      res.status(201).json({ request: toPublicRequest(accepted) });
      return;
    }

    const request = await prisma.friendRequest.create({
      data: { senderId: me.id, receiverId: target.id },
      include: { sender: true, receiver: true },
    });
    const publicRequest = toPublicRequest(request);
    emitFriendRequest(target.id, publicRequest);
    res.status(201).json({ request: publicRequest });
  })
);

router.post(
  "/friends/requests/:id/accept",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const request = await prisma.friendRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.receiverId !== me.id) throw new HttpError(404, "Request not found");
    if (request.status !== "PENDING") throw new HttpError(409, "Request is no longer pending");

    const pair = orderPair(request.senderId, request.receiverId);
    const now = new Date();
    const [, friendship] = await prisma.$transaction([
      prisma.friendRequest.update({
        where: { id: request.id },
        data: { status: "ACCEPTED", respondedAt: now },
      }),
      prisma.friendship.upsert({ where: { userAId_userBId: pair }, create: pair, update: {} }),
    ]);

    res.json({ friendship });
  })
);

router.post(
  "/friends/requests/:id/decline",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const request = await prisma.friendRequest.findUnique({ where: { id: req.params.id } });
    if (!request || (request.receiverId !== me.id && request.senderId !== me.id)) {
      throw new HttpError(404, "Request not found");
    }
    if (request.status !== "PENDING") throw new HttpError(409, "Request is no longer pending");

    // Receiver declines; sender withdrawing their own request is recorded as CANCELED.
    await prisma.friendRequest.update({
      where: { id: request.id },
      data: { status: request.receiverId === me.id ? "DECLINED" : "CANCELED", respondedAt: new Date() },
    });
    res.status(204).end();
  })
);

router.delete(
  "/friends/:username",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const other = await prisma.user.findUnique({ where: { username: req.params.username } });
    if (!other) throw new HttpError(404, "User not found");

    await prisma.friendship.deleteMany({ where: orderPair(me.id, other.id) });
    res.status(204).end();
  })
);

export default router;
