import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { env } from "../env";
import { generateRawToken, hashToken } from "../lib/crypto";
import { fetchOwnRepos, getFreshGithubToken, GithubAuthError, NoGithubTokenError } from "../lib/github";
import { asyncHandler, HttpError } from "../lib/http-error";
import { fromPayloadValue } from "../lib/json-field";
import { computeLevel, computeLevels } from "../lib/level";
import { detectIcon, detectLabel } from "../lib/links";
import { normalizeModel, presenceFor, utcDay } from "../lib/sessions";
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

/**
 * Repo picker (round 5) — the owner's own repos, for attaching one to a project.
 * Auth precedence and scope policy: lib/github.ts's fetchOwnRepos. 409 (not 401/
 * 403) covers every "the browser is authenticated but GitHub access isn't usable"
 * case — never connected, or connected-but-expired — because the fix for all of
 * them is the same user action (sign in with GitHub), and the web treats 409 here
 * as "show the connect/reconnect hint" rather than a hard error.
 *
 * getFreshGithubToken renews an expired GitHub App token transparently; it only
 * throws GithubAuthError when renewal is impossible (no/rejected refresh token).
 * A late 401 from GitHub itself — token looked in-date to us but GitHub rejected it
 * (revoked, app uninstalled, or a legacy row whose real expiry we never stored) —
 * is mapped here too, so this route never degrades into an opaque 500.
 */
router.get(
  "/users/me/github/repos",
  requireAuth,
  asyncHandler(async (req, res) => {
    let token: string | null;
    try {
      token = await getFreshGithubToken(req.user!);
    } catch (err) {
      if (err instanceof GithubAuthError) {
        throw new HttpError(409, "GitHub access expired. Sign in with GitHub again to reconnect.");
      }
      throw err;
    }
    try {
      const repos = await fetchOwnRepos(req.user!.id, token);
      res.json({ repos });
    } catch (err) {
      if (err instanceof NoGithubTokenError) {
        throw new HttpError(409, "No GitHub account connected. Sign in with GitHub to list your repos.");
      }
      if (err instanceof Error && /^GitHub 401$/.test(err.message)) {
        throw new HttpError(409, "GitHub access expired. Sign in with GitHub again to reconnect.");
      }
      throw err;
    }
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
    const { label, replaceUnused } = createTrackerTokenSchema.parse(req.body);
    const userId = req.user!.id;
    const raw = generateRawToken();
    // "Token minted once" (§5.2): with `replaceUnused`, every token of the caller's
    // that was never used (lastUsedAt null — never verified, never heartbeated) is
    // revoked in the same transaction that creates the new one, so a retried connect
    // flow never leaves two live-but-unused tokens behind and never shows a token in
    // the list that the tracker will not accept. Used tokens are live devices and
    // stay untouched; the response shape is the same either way.
    const created = await prisma.$transaction(async (tx) => {
      if (replaceUnused) {
        await tx.trackerToken.updateMany({
          where: { userId, lastUsedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return tx.trackerToken.create({ data: { userId, label, tokenHash: hashToken(raw) } });
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
 * (onboarding step, Home banner, Settings). `connected`/`lastSeenAt` are
 * heartbeat-based (reuse `presenceFor()`, §lib/sessions.ts) — NOT
 * `TrackerToken.lastUsedAt`. That field also gets bumped by `/tracker/verify`
 * (the `login` command's own token check, before any daemon or heartbeat
 * exists), so a `connected` derived from it flipped true — and hid the Home
 * banner — the instant `login` ran, well before the tracker was actually
 * running or reporting anything. Round 5 root cause of a live PO report:
 * banner gone, presence dot still empty. The old signal is still useful (it's
 * genuinely "has this token ever been used for anything") — exposed as the
 * new `tokenLastUsedAt` field rather than folded back into `lastSeenAt`.
 * `tools` lists what's been seen recently so the user gets confirmation that
 * e.g. Claude Code is counted.
 *
 * v2 (ARCHITECTURE.md §5.2) adds what the "what's connected / is everything
 * tracking" panel needs on top of the same fields:
 *  - `presence`: the same snapshot friends see (status + current activity).
 *  - `sources`: every (tool, model) pair seen in the last 7 days with per-pair
 *    token totals, most recently seen first. Built from three places because no
 *    single table has it: DailyStat (closed sessions + v2 `usage[]` tokens), open
 *    Sessions (live tokens/elapsed not folded yet — same "one place at a time"
 *    rule as routes/stats.ts, so nothing double counts), and the newest
 *    HEARTBEAT/SESSION_START ActivityEvents (the only record of *when* a pair was
 *    last reported, including `usage[]` sources that never own a Session).
 *  - `devices`: the non-revoked tracker tokens, so the panel can say which
 *    machine is reporting without a second request.
 *  - `heartbeatIntervalMs`: the tracker's cadence, so "last seen 40s ago" can be
 *    rendered as "one missed beat" rather than as an absolute.
 * Polled every 5s by the UI, so it stays at six queries regardless of history size
 * (the event scan is capped at SOURCE_EVENT_LIMIT newest rows).
 */
const HEARTBEAT_INTERVAL_MS = 30_000; // tracker default HEARTBEAT_INTERVAL_MS (§4.2)
const SOURCE_WINDOW_DAYS = 7;
const SOURCE_EVENT_LIMIT = 400;
const TOOLS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

interface TrackerSource {
  tool: string;
  /** null for presence-only tools — the DailyStat "unknown" bucket maps back to null here. */
  model: string | null;
  lastSeenAt: Date;
  tokensToday: number;
  tokens7d: number;
  activeSecondsToday: number;
}

router.get(
  "/users/me/tracker",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const now = new Date();
    const today = utcDay(now);
    // Aligned to UTC days so DailyStat rows (per UTC day), Sessions and events all
    // cover the same window: today plus the six days before it.
    const since7d = new Date(today.getTime() - (SOURCE_WINDOW_DAYS - 1) * 86_400_000);
    const since30d = new Date(now.getTime() - TOOLS_WINDOW_MS);

    const [tokens, sessions, latestHeartbeat, dailyStats, events, presence] = await Promise.all([
      prisma.trackerToken.findMany({
        where: { userId, revokedAt: null },
        select: { id: true, label: true, lastUsedAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      // One query serves both `tools` (30-day distinct, done in memory — Prisma's
      // `distinct` is in-memory anyway) and the open/recent sessions for `sources`.
      prisma.session.findMany({
        where: { userId, lastHeartbeatAt: { gte: since30d } },
        orderBy: { lastHeartbeatAt: "desc" },
      }),
      prisma.session.findFirst({
        where: { userId },
        orderBy: { lastHeartbeatAt: "desc" },
        select: { lastHeartbeatAt: true },
      }),
      prisma.dailyStat.findMany({ where: { userId, date: { gte: since7d } } }),
      prisma.activityEvent.findMany({
        where: { userId, type: { in: ["HEARTBEAT", "SESSION_START"] }, occurredAt: { gte: since7d } },
        orderBy: { occurredAt: "desc" },
        take: SOURCE_EVENT_LIMIT,
        select: { occurredAt: true, payload: true },
      }),
      presenceFor(userId, req.user!.username),
    ]);

    const tokenLastUsedAt = tokens.reduce<Date | null>(
      (max, t) => (t.lastUsedAt && (!max || t.lastUsedAt > max) ? t.lastUsedAt : max),
      null
    );

    const sources = new Map<string, TrackerSource>();
    const seen = (tool: string, model: string | null, at: Date): TrackerSource => {
      const key = `${tool}\0${model ?? ""}`;
      const existing = sources.get(key);
      if (!existing) {
        const created: TrackerSource = { tool, model, lastSeenAt: at, tokensToday: 0, tokens7d: 0, activeSecondsToday: 0 };
        sources.set(key, created);
        return created;
      }
      if (at > existing.lastSeenAt) existing.lastSeenAt = at;
      return existing;
    };

    // (1) Folded totals. The row's UTC day is only a floor for lastSeenAt — events and
    // sessions below refine it to the actual last report time.
    for (const row of dailyStats) {
      const source = seen(row.tool, normalizeModel(row.model), row.date);
      const tokensTotal = row.tokensInput + row.tokensOutput;
      source.tokens7d += tokensTotal;
      if (row.date.getTime() === today.getTime()) {
        source.tokensToday += tokensTotal;
        source.activeSecondsToday += row.activeSeconds;
      }
    }

    // (2) Sessions: any recent one pins lastSeenAt; only OPEN ones still hold tokens
    // and elapsed time that haven't reached DailyStat yet (bucketed by start day, the
    // same day foldIntoDailyStat will use when it closes).
    for (const session of sessions) {
      if (session.lastHeartbeatAt < since7d) continue;
      const source = seen(session.tool, normalizeModel(session.model), session.lastHeartbeatAt);
      if (session.status === "ENDED") continue;
      const tokensTotal = session.tokensInput + session.tokensOutput;
      const elapsed = Math.max(0, Math.round((session.lastHeartbeatAt.getTime() - session.startedAt.getTime()) / 1000));
      source.tokens7d += tokensTotal;
      if (utcDay(session.startedAt).getTime() === today.getTime()) {
        source.tokensToday += tokensTotal;
        source.activeSecondsToday += elapsed;
      }
    }

    // (3) Events: the presence pair of every heartbeat plus each v2 `usage[]` source.
    // Payload fields are read defensively — it's a JSON column written by several
    // server versions, so shape is asserted, not assumed.
    const modelOf = (value: unknown) => normalizeModel(typeof value === "string" ? value : null);
    for (const event of events) {
      const payload = fromPayloadValue(event.payload);
      if (typeof payload.tool === "string" && payload.tool) seen(payload.tool, modelOf(payload.model), event.occurredAt);
      if (!Array.isArray(payload.usage)) continue;
      for (const entry of payload.usage as unknown[]) {
        if (!entry || typeof entry !== "object") continue;
        const { tool, model } = entry as Record<string, unknown>;
        if (typeof tool === "string" && tool) seen(tool, modelOf(model), event.occurredAt);
      }
    }

    res.json({
      connected: presence.status !== "offline",
      lastSeenAt: latestHeartbeat?.lastHeartbeatAt ?? null,
      activeTokens: tokens.length,
      // Sessions arrive newest first, so the first occurrence of each tool wins.
      tools: [...new Set(sessions.map((s) => s.tool))],
      tokenLastUsedAt,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      presence: { status: presence.status, activity: presence.activity, tools: presence.tools },
      sources: [...sources.values()].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()),
      devices: tokens.map((t) => ({ id: t.id, label: t.label, lastUsedAt: t.lastUsedAt, createdAt: t.createdAt })),
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
