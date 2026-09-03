import jwt from "jsonwebtoken";
import { env } from "../env";

export const SESSION_COOKIE = "vh_session";

// MVP choice — not pinned by ARCHITECTURE.md, which only requires AuthSession to
// support revocation, not a specific lifetime.
export const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// One-time ticket so the web origin can set the session cookie via fetch
// (cross-site 302 Set-Cookie is dropped by Chrome on the GitHub → API → web hop).
const HANDOFF_TTL_SEC = 60;

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

export function signHandoffToken(sessionToken: string): string {
  return jwt.sign({ kind: "handoff", session: sessionToken }, env.jwtSecret, {
    expiresIn: HANDOFF_TTL_SEC,
  });
}

export function verifyHandoffToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    if (
      typeof decoded === "string" ||
      decoded.kind !== "handoff" ||
      typeof decoded.session !== "string"
    ) {
      return null;
    }
    return decoded.session;
  } catch {
    return null;
  }
}
