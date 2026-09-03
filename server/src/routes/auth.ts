import crypto from "node:crypto";
import type { Response } from "express";
import { Router } from "express";
import { AUTH_SESSION_TTL_MS, SESSION_COOKIE, signSessionToken, verifySessionToken } from "../auth/jwt";
import { prisma } from "../db";
import { env, primaryWebOrigin } from "../env";
import { encryptSecret } from "../lib/crypto";
import { asyncHandler, HttpError } from "../lib/http-error";
import { devLoginSchema } from "../lib/schemas";
import { toMeUser } from "../lib/serializers";
import { optionalAuth } from "../middleware/auth";

const router = Router();

const OAUTH_STATE_COOKIE = "vh_oauth_state";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_API = "https://api.github.com/user";

interface GithubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GithubUserResponse {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
}

async function createAuthSession(userId: string, userAgent: string | undefined): Promise<string> {
  const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_MS);
  const authSession = await prisma.authSession.create({ data: { userId, userAgent, expiresAt } });
  return signSessionToken(userId, authSession.id);
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: env.cookieSameSite,
    // SameSite=None is only accepted by browsers together with Secure.
    secure: env.isProduction || env.cookieSameSite === "none",
    maxAge: AUTH_SESSION_TTL_MS,
    path: "/",
  });
}

async function generateAvailableUsername(githubLogin: string): Promise<string> {
  const base =
    githubLogin
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "user";
  const padded = base.length >= 3 ? base : base.padEnd(3, "0");

  let candidate = padded;
  let suffix = 0;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.user.findUnique({ where: { username: candidate } })) {
    suffix += 1;
    const suffixStr = `-${suffix}`;
    candidate = `${padded.slice(0, Math.max(3, 24 - suffixStr.length))}${suffixStr}`;
  }
  return candidate;
}

router.get("/github", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    maxAge: 5 * 60 * 1000,
    path: "/",
  });

  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", env.githubClientId);
  url.searchParams.set("redirect_uri", env.githubCallbackUrl);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

router.get(
  "/github/callback",
  asyncHandler(async (req, res) => {
    const { code, state } = req.query;
    const cookieState = req.cookies?.[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });

    if (!code || typeof code !== "string" || !state || state !== cookieState) {
      throw new HttpError(400, "Invalid or missing OAuth state");
    }

    const tokenRes = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: env.githubClientId,
        client_secret: env.githubClientSecret,
        code,
        redirect_uri: env.githubCallbackUrl,
      }),
    });
    const tokenJson = (await tokenRes.json()) as GithubTokenResponse;
    if (!tokenJson.access_token) {
      throw new HttpError(400, `GitHub OAuth failed: ${tokenJson.error_description ?? tokenJson.error ?? "unknown error"}`);
    }

    const ghUserRes = await fetch(GITHUB_USER_API, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}`, "User-Agent": "vibehub-server" },
    });
    if (!ghUserRes.ok) throw new HttpError(400, "Failed to fetch GitHub profile");
    const ghUser = (await ghUserRes.json()) as GithubUserResponse;

    const githubId = String(ghUser.id);
    const encryptedToken = encryptSecret(tokenJson.access_token);

    let user = await prisma.user.findUnique({ where: { githubId } });
    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          githubUsername: ghUser.login,
          githubAccessToken: encryptedToken,
          avatarUrl: user.avatarUrl ?? ghUser.avatar_url ?? null,
        },
      });
    } else {
      const username = await generateAvailableUsername(ghUser.login);
      user = await prisma.user.create({
        data: {
          username,
          displayName: ghUser.name?.trim() || ghUser.login,
          githubId,
          githubUsername: ghUser.login,
          githubAccessToken: encryptedToken,
          avatarUrl: ghUser.avatar_url ?? null,
        },
      });
    }

    const token = await createAuthSession(user.id, req.header("user-agent"));
    setSessionCookie(res, token);
    res.redirect(primaryWebOrigin);
  })
);

router.post(
  "/dev-login",
  asyncHandler(async (req, res) => {
    if (!env.devLoginEnabled) throw new HttpError(404, "Not found");

    const { username } = devLoginSchema.parse(req.body);
    let user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      user = await prisma.user.create({
        data: { username, displayName: username, isDevAccount: true },
      });
    }

    const token = await createAuthSession(user.id, req.header("user-agent"));
    setSessionCookie(res, token);
    res.json({ user: toMeUser(user) });
  })
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const payload = verifySessionToken(token);
      if (payload) {
        await prisma.authSession.updateMany({
          where: { id: payload.jti },
          data: { revokedAt: new Date() },
        });
      }
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  })
);

router.get("/me", optionalAuth, (req, res) => {
  res.json({ user: req.user ? toMeUser(req.user) : null });
});

export default router;
