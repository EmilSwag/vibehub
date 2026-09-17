import type { User } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db";
import { SESSION_COOKIE, verifySessionToken } from "../auth/jwt";
import { hashToken } from "../lib/crypto";
import { asyncHandler, HttpError } from "../lib/http-error";
import { TRACKER_AUTH_MAX_AGE_MS } from "../lib/trackerConnection";
import { retireTrackerConnection } from "../services/trackerConnection";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      trackerUserId?: string;
      trackerTokenId?: string;
    }
  }
}

// Shared by the HTTP cookie-auth middlewares below and the WebSocket upgrade
// handshake (src/ws/index.ts), so both surfaces honor AuthSession revocation the
// same way.
export async function resolveSessionUser(cookieValue: string | undefined): Promise<User | null> {
  if (!cookieValue) return null;
  const payload = verifySessionToken(cookieValue);
  if (!payload) return null;

  const authSession = await prisma.authSession.findUnique({ where: { id: payload.jti } });
  if (!authSession || authSession.revokedAt || authSession.expiresAt < new Date()) return null;
  if (authSession.userId !== payload.sub) return null;

  return prisma.user.findUnique({ where: { id: payload.sub } });
}

export const optionalAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  req.user = (await resolveSessionUser(req.cookies?.[SESSION_COOKIE])) ?? undefined;
  next();
});

export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const user = await resolveSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) throw new HttpError(401, "Not authenticated");
  req.user = user;
  next();
});

/**
 * Session cookie *or* `Authorization: Bearer <device token>` → `req.user`.
 * Lets AI agents (Claude Code, Codex, a curl in CI) publish projects with the
 * same token the tracker uses. Unlike `requireTrackerToken` it does NOT bump
 * `lastUsedAt` — publishing a project must not make the tracker look connected.
 */
export const requireUserOrToken = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const fromCookie = await resolveSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (fromCookie) {
    req.user = fromCookie;
    next();
    return;
  }
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Not authenticated");
  const token = await prisma.trackerToken.findUnique({
    where: { tokenHash: hashToken(header.slice("Bearer ".length).trim()) },
    include: { user: true },
  });
  if (!token || token.revokedAt) throw new HttpError(401, "Invalid or revoked token");
  req.user = token.user;
  req.trackerTokenId = token.id;
  next();
});

/** Revoked-token attempts are recorded at most this often per token (see below). */
const REJECTED_WRITE_THROTTLE_MS = 60_000;

export const requireTrackerToken = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const startedAt = Date.now();
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Missing bearer token");

  const raw = header.slice("Bearer ".length).trim();
  const tokenHash = hashToken(raw);
  const token = await prisma.trackerToken.findUnique({ where: { tokenHash } });
  if (token?.revokedAt) {
    // Rejection can retire only this opaque device, never another connection or
    // actual AI Session. Preserve 401 even if a best-effort notification fails.
    await retireTrackerConnection(token.userId, token.id, true).catch(() => undefined);
    const stale = !token.lastRejectedAt || Date.now() - token.lastRejectedAt.getTime() > REJECTED_WRITE_THROTTLE_MS;
    if (stale) {
      await prisma.trackerToken
        .update({ where: { id: token.id }, data: { lastRejectedAt: new Date() } })
        .catch(() => undefined);
    }
  }
  if (!token || token.revokedAt) throw new HttpError(401, "Invalid or revoked tracker token");

  // This remains authentication bookkeeping, not a connection receipt. The
  // conditional write also rejects a token revoked while its lookup was pending.
  const updated = await prisma.trackerToken.updateMany({
    where: { id: token.id, revokedAt: null },
    data: { lastUsedAt: new Date() },
  });
  if (updated.count !== 1) {
    await retireTrackerConnection(token.userId, token.id, true).catch(() => undefined);
    throw new HttpError(401, "Invalid or revoked tracker token");
  }
  // Bound the life of a cached auth decision. Revocation tombstones outlive it;
  // connection handlers record synchronously before their first subsequent await.
  const elapsed = Date.now() - startedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= TRACKER_AUTH_MAX_AGE_MS) {
    throw new HttpError(401, "Tracker authentication expired; retry");
  }
  req.trackerUserId = token.userId;
  req.trackerTokenId = token.id;
  next();
});
