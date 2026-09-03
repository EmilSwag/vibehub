import jwt from "jsonwebtoken";
import { env } from "../env";

export const SESSION_COOKIE = "vh_session";

// MVP choice — not pinned by ARCHITECTURE.md, which only requires AuthSession to
// support revocation, not a specific lifetime.
export const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionTokenPayload {
  sub: string;
  jti: string;
}

export function signSessionToken(userId: string, authSessionId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, {
    jwtid: authSessionId,
    expiresIn: AUTH_SESSION_TTL_MS / 1000,
  });
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    if (typeof decoded === "string" || !decoded.sub || !decoded.jti) return null;
    return { sub: decoded.sub, jti: decoded.jti };
  } catch {
    return null;
  }
}
