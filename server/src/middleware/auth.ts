import type { User } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db";
import { SESSION_COOKIE, verifySessionToken } from "../auth/jwt";
import { hashToken } from "../lib/crypto";
import { asyncHandler, HttpError } from "../lib/http-error";

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

export const requireTrackerToken = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Missing bearer token");

  const raw = header.slice("Bearer ".length).trim();
  const tokenHash = hashToken(raw);
  const token = await prisma.trackerToken.findUnique({ where: { tokenHash } });
  if (!token || token.revokedAt) throw new HttpError(401, "Invalid or revoked tracker token");

  await prisma.trackerToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  req.trackerUserId = token.userId;
  req.trackerTokenId = token.id;
  next();
});
