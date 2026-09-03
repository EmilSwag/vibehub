import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { env } from "../env";
import { generateRawToken, hashToken } from "../lib/crypto";
import { asyncHandler, HttpError } from "../lib/http-error";
import { computeLevel, computeLevels } from "../lib/level";
import { detectIcon, detectLabel } from "../lib/links";
import {
  createTrackerTokenSchema,
  patchMeSchema,
  putLinksSchema,
  rolesToCsv,
  suggestedUsersQuerySchema,
} from "../lib/schemas";
import { toMeUser, toPublicLink, toPublicUser } from "../lib/serializers";
import { requireAuth } from "../middleware/auth";

const router = Router();

// Persistent volume on Railway (see env.uploadDir); served by index.ts under /uploads.
const AVATAR_DIR = path.join(env.uploadDir, "avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });

/**
 * Best-effort removal of a previous avatar file we wrote ourselves, so a persistent
 * volume doesn't accumulate one orphaned file per re-upload. Only touches files
 * directly inside AVATAR_DIR; foreign URLs (e.g. GitHub avatars) are ignored.
 */
function removeOwnAvatarFile(avatarUrl: string | null): void {
  if (!avatarUrl) return;
  let pathname: string;
  try {
    pathname = new URL(avatarUrl).pathname;
  } catch {
    return;
  }
  const prefix = "/uploads/avatars/";
  if (!pathname.startsWith(prefix)) return;
  const filename = path.basename(pathname);
  if (!filename || filename !== pathname.slice(prefix.length)) return;
  fs.rm(path.join(AVATAR_DIR, filename), { force: true }, () => undefined);
}

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: AVATAR_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".png";
      cb(null, `${req.user!.id}-${crypto.randomBytes(6).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new HttpError(400, "File must be an image"));
      return;
    }
    cb(null, true);
  },
});

/**
 * People you might know — onboarding step 3 and the Friends page search.
 * Everyone except me, my friends, and anyone with a pending request either way.
 * `q` filters by username/displayName (case-insensitive contains); default order is
 * newest accounts first so a fresh friend group sees each other immediately.
 * Must be registered before `/users/:username` or "suggested" is treated as a username.
 */
router.get(
  "/users/suggested",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { q, limit } = suggestedUsersQuerySchema.parse(req.query);
    const me = req.user!.id;

    const [friendships, pending] = await Promise.all([
      prisma.friendship.findMany({
        where: { OR: [{ userAId: me }, { userBId: me }] },
        select: { userAId: true, userBId: true },
      }),
      prisma.friendRequest.findMany({
        where: { status: "PENDING", OR: [{ senderId: me }, { receiverId: me }] },
        select: { senderId: true, receiverId: true },
      }),
    ]);
    const exclude = new Set<string>([me]);
    for (const f of friendships) exclude.add(f.userAId === me ? f.userBId : f.userAId);
    const invited = new Set<string>();
    for (const r of pending) {
      const other = r.senderId === me ? r.receiverId : r.senderId;
      exclude.add(other);
      if (r.senderId === me) invited.add(other);
    }

    // SQLite (dev) has no `mode: "insensitive"`; usernames are lowercase anyway and
    // displayName matching is a nicety, so filter in memory on a bounded candidate set.
    const candidates = await prisma.user.findMany({
      where: { id: { notIn: [...exclude] } },
      orderBy: { createdAt: "desc" },
      take: q ? 200 : limit,
    });
    const needle = q?.toLowerCase();
    const users = (needle
      ? candidates.filter(
          (u) =>
            u.username.includes(needle) || u.displayName.toLowerCase().includes(needle)
        )
      : candidates
    ).slice(0, limit);

    const levels = await computeLevels(users.map((u) => u.id));
    res.json({
      users: users.map((u) => ({ ...toPublicUser(u), level: levels.get(u.id) ?? 1 })),
      invitedIds: [...invited],
    });
  })
);

router.get(
  "/users/:username",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { username: req.params.username },
      include: { externalLinks: { orderBy: { order: "asc" } } },
    });
    if (!user) throw new HttpError(404, "User not found");

    const [friendCount, level] = await Promise.all([
      prisma.friendship.count({
        where: { OR: [{ userAId: user.id }, { userBId: user.id }] },
      }),
      computeLevel(user.id),
    ]);

    res.json({
      user: toPublicUser(user),
      links: user.externalLinks.map(toPublicLink),
      archetype: user.archetype,
      friendCount,
      level: level.level,
      levelBreakdown: level,
    });
  })
);

/** Marks onboarding as finished; idempotent. */
router.post(
  "/users/me/onboarding/complete",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { onboardedAt: req.user!.onboardedAt ?? new Date() },
    });
    res.json({ user: toMeUser(user) });
  })
);

router.patch(
  "/users/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { roles, ...rest } = patchMeSchema.parse(req.body);
    if (rest.username && rest.username !== req.user!.username) {
      const taken = await prisma.user.findUnique({ where: { username: rest.username } });
      if (taken) throw new HttpError(409, "That nickname is taken");
    }
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { ...rest, ...(roles ? { roles: rolesToCsv(roles) } : {}) },
    });
    res.json({ user: toMeUser(user) });
  })
);

router.post(
  "/users/me/avatar",
  requireAuth,
  avatarUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Missing file");
    const avatarUrl = `${req.protocol}://${req.get("host")}/uploads/avatars/${req.file.filename}`;
    const previous = req.user!.avatarUrl;
    await prisma.user.update({ where: { id: req.user!.id }, data: { avatarUrl } });
    removeOwnAvatarFile(previous);
    res.json({ avatarUrl });
  })
);

router.put(
  "/users/me/links",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { links } = putLinksSchema.parse(req.body);
    const userId = req.user!.id;

    await prisma.$transaction([
      prisma.externalLink.deleteMany({ where: { userId } }),
      ...links.map((link, index) =>
        prisma.externalLink.create({
          data: {
            userId,
            url: link.url,
            label: link.label ?? detectLabel(link.url),
            icon: detectIcon(link.url),
            order: index,
          },
        })
      ),
    ]);

    const saved = await prisma.externalLink.findMany({ where: { userId }, orderBy: { order: "asc" } });
    res.json({ links: saved.map(toPublicLink) });
  })
);

router.post(
  "/users/me/tracker-tokens",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { label } = createTrackerTokenSchema.parse(req.body);
    const raw = generateRawToken();
    const created = await prisma.trackerToken.create({
      data: { userId: req.user!.id, label, tokenHash: hashToken(raw) },
    });
    res.json({ token: raw, tokenId: created.id });
  })
);

router.get(
  "/users/me/tracker-tokens",
  requireAuth,
  asyncHandler(async (req, res) => {
    const tokens = await prisma.trackerToken.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      tokens: tokens.map((t) => ({
        id: t.id,
        label: t.label,
        lastUsedAt: t.lastUsedAt,
        revokedAt: t.revokedAt,
        createdAt: t.createdAt,
      })),
    });
  })
);

/**
 * "Is my tracker actually talking to us?" — drives the Connect-your-tools panel
 * (onboarding step, Home banner, Settings). `connected` flips true on the first
 * authenticated heartbeat (TrackerToken.lastUsedAt); `tools` lists what it has
 * seen recently so the user gets confirmation that e.g. Claude Code is counted.
 */
router.get(
  "/users/me/tracker",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [tokens, sessions] = await Promise.all([
      prisma.trackerToken.findMany({
        where: { userId, revokedAt: null },
        select: { lastUsedAt: true },
      }),
      prisma.session.findMany({
        where: { userId, lastHeartbeatAt: { gte: since } },
        distinct: ["tool"],
        select: { tool: true },
        orderBy: { lastHeartbeatAt: "desc" },
      }),
    ]);
    const lastSeenAt = tokens.reduce<Date | null>(
      (max, t) => (t.lastUsedAt && (!max || t.lastUsedAt > max) ? t.lastUsedAt : max),
      null
    );
    res.json({
      connected: lastSeenAt !== null,
      lastSeenAt,
      activeTokens: tokens.length,
      tools: sessions.map((s) => s.tool),
    });
  })
);

router.delete(
  "/users/me/tracker-tokens/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const token = await prisma.trackerToken.findUnique({ where: { id: req.params.id } });
    if (!token || token.userId !== req.user!.id) throw new HttpError(404, "Token not found");
    await prisma.trackerToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    res.status(204).end();
  })
);

export default router;
