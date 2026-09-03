import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { generateRawToken, hashToken } from "../lib/crypto";
import { asyncHandler, HttpError } from "../lib/http-error";
import { detectIcon, detectLabel } from "../lib/links";
import { createTrackerTokenSchema, patchMeSchema, putLinksSchema } from "../lib/schemas";
import { toMeUser, toPublicLink, toPublicUser } from "../lib/serializers";
import { requireAuth } from "../middleware/auth";

const router = Router();

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const AVATAR_DIR = path.join(UPLOAD_ROOT, "avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });

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

router.get(
  "/users/:username",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { username: req.params.username },
      include: { externalLinks: { orderBy: { order: "asc" } } },
    });
    if (!user) throw new HttpError(404, "User not found");

    const friendCount = await prisma.friendship.count({
      where: { OR: [{ userAId: user.id }, { userBId: user.id }] },
    });

    res.json({
      user: toPublicUser(user),
      links: user.externalLinks.map(toPublicLink),
      archetype: user.archetype,
      friendCount,
    });
  })
);

router.patch(
  "/users/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = patchMeSchema.parse(req.body);
    const user = await prisma.user.update({ where: { id: req.user!.id }, data });
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
    await prisma.user.update({ where: { id: req.user!.id }, data: { avatarUrl } });
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
