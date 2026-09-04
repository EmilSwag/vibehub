/**
 * GitHub API access for project detail pages and the repo picker.
 *
 * Auth precedence everywhere here, per round-5 spec: the resource owner's stored
 * OAuth token first (decrypted — see the bug note below), then the server's own
 * `GITHUB_TOKEN` env var, then anonymous. Fetched server-side so the browser never
 * touches GitHub directly and private repos work for their owner.
 *
 * Bug fixed in this round: callers used to pass `User.githubAccessToken` straight
 * through as the Bearer token. That column is encrypted at rest (see
 * lib/crypto.ts's encryptSecret, applied in routes/auth.ts's OAuth callback) — the
 * ciphertext was being sent to GitHub as-is, which GitHub always rejects, so the
 * owner's real token was silently never used; every request fell through to the
 * GITHUB_TOKEN env fallback or anonymous, even for the repo's own owner. Every
 * function here now takes the already-decrypted token (decryptGithubToken below)
 * or null.
 */

import { prisma } from "../db";
import { env } from "../env";
import { decryptSecret, encryptSecret } from "./crypto";

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RepoCommit {
  sha: string;
  message: string;
  authorName: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  committedAt: string;
  url: string;
  /** null when GitHub rate-limited the per-commit stats call — never fails the page. */
  additions: number | null;
  deletions: number | null;
  filesChanged: number | null;
}

export interface RepoBuild {
  /** GitHub Actions conclusion when finished ("success"/"failure"/...), else its run status. */
  status: string;
  url: string;
  branch: string;
  headSha: string;
  updatedAt: string;
}

export interface RepoRelease {
  tag: string;
  name: string;
  url: string;
  publishedAt: string;
}

export interface RepoActivity {
  repo: RepoRef;
  commits: RepoCommit[];
  /** ISO of the newest commit — the project's "last push". */
  lastPushAt: string | null;
  fetchedAt: string;
  build: RepoBuild | null;
  latestRelease: RepoRelease | null;
}

export interface GithubRepoSummary {
  fullName: string;
  name: string;
  htmlUrl: string;
  description: string | null;
  private: boolean;
  pushedAt: string | null;
  defaultBranch: string;
  language: string | null;
  stars: number;
}

const COMMITS_CACHE_TTL_MS = 10 * 60 * 1000;
const REPOS_CACHE_TTL_MS = 5 * 60 * 1000;
const GITHUB_TIMEOUT_MS = 8000;
const MAX_COMMITS_WITH_STATS = 30;

const commitsCache = new Map<string, { at: number; value: RepoActivity }>();
const reposCache = new Map<string, { at: number; value: GithubRepoSummary[] }>();

/** Decrypts `User.githubAccessToken`; null/empty/corrupt all resolve to null (never throws). */
export function decryptGithubToken(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    return decryptSecret(encrypted);
  } catch {
    return null;
  }
}

const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";
// Renew a little before the token actually dies so an in-flight request never races
// the expiry boundary.
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/**
 * Thrown when a user *did* connect GitHub but the stored credentials can no longer
 * be used and can't be renewed (access token expired/revoked and no usable refresh
 * token) — i.e. the only fix is for the user to sign in with GitHub again. Callers
 * map this to a 409 with a "reconnect GitHub" message, distinct from
 * NoGithubTokenError (never connected at all).
 */
export class GithubAuthError extends Error {}

/** Just the User columns getFreshGithubToken needs — so callers can pass a full row or a narrow select. */
export interface GithubCredentialFields {
  id: string;
  githubAccessToken: string | null;
  githubRefreshToken: string | null;
  githubTokenExpiresAt: Date | null;
  githubRefreshTokenExpiresAt: Date | null;
}

interface GithubRefreshResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * A GitHub access token that is valid *right now* for `user`, or null if the user has
 * never connected GitHub.
 *
 * GitHub App user-to-server tokens expire (~8h); classic OAuth-App tokens don't. This
 * hides that difference from callers:
 *  - no stored token            → null (NoGithubTokenError territory — never connected)
 *  - non-expiring / still valid → the stored access token, as-is
 *  - expired but refreshable    → transparently refreshed via the refresh token, the
 *                                 new access+refresh pair persisted, fresh token returned
 *  - expired and NOT refreshable→ throws GithubAuthError (caller ⇒ "reconnect GitHub")
 *
 * Accounts connected before refresh support existed have a (now-expired) access token
 * and null refresh fields: `githubTokenExpiresAt` is null, so the stale token is tried
 * once and GitHub's 401 surfaces at the call site — the caller maps that to reconnect.
 */
export async function getFreshGithubToken(user: GithubCredentialFields): Promise<string | null> {
  const accessToken = decryptGithubToken(user.githubAccessToken);
  if (!accessToken) return null;

  const expiresAt = user.githubTokenExpiresAt;
  // Non-expiring (classic OAuth App / legacy row) or comfortably in-date: use as-is.
  if (!expiresAt || expiresAt.getTime() - Date.now() > TOKEN_EXPIRY_SKEW_MS) {
    return accessToken;
  }

  // Expiring token that's at/near expiry — try to refresh.
  const refreshToken = decryptGithubToken(user.githubRefreshToken);
  const refreshExpiresAt = user.githubRefreshTokenExpiresAt;
  if (!refreshToken || (refreshExpiresAt && refreshExpiresAt.getTime() <= Date.now())) {
    throw new GithubAuthError("GitHub access expired and cannot be refreshed");
  }

  let res: Response;
  try {
    res = await fetch(GITHUB_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: env.githubClientId,
        client_secret: env.githubClientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch {
    // Network/timeout talking to GitHub — not the user's fault, don't force a reconnect.
    throw new Error("GitHub token refresh request failed");
  }

  const json = (await res.json().catch(() => ({}))) as GithubRefreshResponse;
  if (!res.ok || !json.access_token) {
    // GitHub rejected the refresh token (revoked, app uninstalled, expired) — reconnect.
    throw new GithubAuthError(`GitHub token refresh rejected: ${json.error ?? res.status}`);
  }

  // Persist the rotated pair (GitHub rotates the refresh token on each use).
  await prisma.user.update({
    where: { id: user.id },
    data: {
      githubAccessToken: encryptSecret(json.access_token),
      githubRefreshToken: json.refresh_token ? encryptSecret(json.refresh_token) : user.githubRefreshToken,
      githubTokenExpiresAt:
        typeof json.expires_in === "number" ? new Date(Date.now() + json.expires_in * 1000) : null,
      githubRefreshTokenExpiresAt:
        typeof json.refresh_token_expires_in === "number"
          ? new Date(Date.now() + json.refresh_token_expires_in * 1000)
          : refreshExpiresAt,
    },
  });
  return json.access_token;
}

function authHeaders(token: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "vibehub",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const resolved = token || process.env.GITHUB_TOKEN;
  if (resolved) headers.Authorization = `Bearer ${resolved}`;
  return headers;
}

/** `https://github.com/owner/repo(.git)(/...)` → { owner, repo } or null. */
export function parseGithubRepoUrl(url: string | null | undefined): RepoRef | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
    const [owner, repoRaw] = u.pathname.split("/").filter(Boolean);
    if (!owner || !repoRaw) return null;
    const repo = repoRaw.replace(/\.git$/i, "");
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

interface GithubCommitJson {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name?: string; date?: string } | null };
  author: { login?: string; avatar_url?: string } | null;
}

interface GithubCommitDetailJson {
  stats?: { additions?: number; deletions?: number };
  files?: unknown[];
}

/** Per-commit additions/deletions/filesChanged — GitHub's list endpoint omits these. */
async function fetchCommitStats(
  ref: RepoRef,
  sha: string,
  headers: Record<string, string>
): Promise<Pick<RepoCommit, "additions" | "deletions" | "filesChanged">> {
  try {
    const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${sha}`, {
      headers,
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!res.ok) return { additions: null, deletions: null, filesChanged: null };
    const json = (await res.json()) as GithubCommitDetailJson;
    return {
      additions: json.stats?.additions ?? null,
      deletions: json.stats?.deletions ?? null,
      filesChanged: Array.isArray(json.files) ? json.files.length : null,
    };
  } catch {
    // Rate-limited or timed out — degrade to nulls, never fail the whole page over it.
    return { additions: null, deletions: null, filesChanged: null };
  }
}

interface GithubWorkflowRunJson {
  status: string;
  conclusion: string | null;
  html_url: string;
  head_branch: string;
  head_sha: string;
  updated_at: string;
}

/** Most recent GitHub Actions run, or null (no Actions configured, or any failure). */
async function fetchLatestBuild(ref: RepoRef, headers: Record<string, string>): Promise<RepoBuild | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${ref.owner}/${ref.repo}/actions/runs?per_page=1`,
      { headers, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { workflow_runs?: GithubWorkflowRunJson[] };
    const run = json.workflow_runs?.[0];
    if (!run) return null;
    return {
      status: run.conclusion ?? run.status,
      url: run.html_url,
      branch: run.head_branch,
      headSha: run.head_sha,
      updatedAt: run.updated_at,
    };
  } catch {
    return null;
  }
}

interface GithubReleaseJson {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
}

/** Latest published release, or null (no releases, or any failure). */
async function fetchLatestRelease(ref: RepoRef, headers: Record<string, string>): Promise<RepoRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!res.ok) return null; // 404 = no releases; anything else also degrades to null
    const json = (await res.json()) as GithubReleaseJson;
    return {
      tag: json.tag_name,
      name: json.name || json.tag_name,
      url: json.html_url,
      publishedAt: json.published_at ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function fetchRepoActivity(
  ref: RepoRef,
  accessToken: string | null | undefined,
  limit = MAX_COMMITS_WITH_STATS
): Promise<RepoActivity> {
  const key = `${ref.owner}/${ref.repo}:${limit}:${accessToken ? "auth" : "anon"}`;
  const hit = commitsCache.get(key);
  if (hit && Date.now() - hit.at < COMMITS_CACHE_TTL_MS) return hit.value;

  const headers = authHeaders(accessToken);
  const cappedLimit = Math.min(limit, MAX_COMMITS_WITH_STATS);

  const [listRes, build, latestRelease] = await Promise.all([
    fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/commits?per_page=${cappedLimit}`, {
      headers,
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    }),
    fetchLatestBuild(ref, headers),
    fetchLatestRelease(ref, headers),
  ]);

  if (!listRes.ok) {
    // 404 (private/nonexistent) and 403 (rate limit) both degrade to "no data"
    // rather than failing the page; the caller shows the repo link regardless.
    const empty: RepoActivity = {
      repo: ref,
      commits: [],
      lastPushAt: null,
      fetchedAt: new Date().toISOString(),
      build: null,
      latestRelease: null,
    };
    if (listRes.status === 403 || listRes.status === 404) {
      commitsCache.set(key, { at: Date.now(), value: empty });
      return empty;
    }
    throw new Error(`GitHub ${listRes.status}`);
  }

  const list = (await listRes.json()) as GithubCommitJson[];
  // Per-commit stats in parallel, per round-5 spec — degrades to nulls on
  // rate-limit rather than serializing 30 sequential requests.
  const stats = await Promise.all(list.map((c) => fetchCommitStats(ref, c.sha, headers)));
  const commits: RepoCommit[] = list.map((c, i) => ({
    sha: c.sha,
    message: c.commit.message.split("\n")[0].slice(0, 200),
    authorName: c.commit.author?.name ?? null,
    authorLogin: c.author?.login ?? null,
    authorAvatarUrl: c.author?.avatar_url ?? null,
    committedAt: c.commit.author?.date ?? new Date(0).toISOString(),
    url: c.html_url,
    ...stats[i],
  }));

  const value: RepoActivity = {
    repo: ref,
    commits,
    lastPushAt: commits[0]?.committedAt ?? null,
    fetchedAt: new Date().toISOString(),
    build,
    latestRelease,
  };
  commitsCache.set(key, { at: Date.now(), value });
  return value;
}

interface GithubRepoJson {
  full_name: string;
  name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  pushed_at: string | null;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
}

export class NoGithubTokenError extends Error {}

/**
 * Repos visible to the *owner's own* token — no scope-widening (round-5 spec):
 * this app only ever requested `read:user user:email` at OAuth time
 * (routes/auth.ts), so this lists whatever GitHub returns for that scope
 * (effectively the owner's public repos) rather than requesting `repo`/
 * `public_repo` to unlock more. Throws NoGithubTokenError if the user never
 * connected GitHub — the route maps that to 409 with a clear message.
 */
export async function fetchOwnRepos(userId: string, accessToken: string | null): Promise<GithubRepoSummary[]> {
  if (!accessToken) throw new NoGithubTokenError();

  const hit = reposCache.get(userId);
  if (hit && Date.now() - hit.at < REPOS_CACHE_TTL_MS) return hit.value;

  const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner", {
    headers: authHeaders(accessToken),
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status}`);
  }

  const json = (await res.json()) as GithubRepoJson[];
  const repos: GithubRepoSummary[] = json.map((r) => ({
    fullName: r.full_name,
    name: r.name,
    htmlUrl: r.html_url,
    description: r.description,
    private: r.private,
    pushedAt: r.pushed_at,
    defaultBranch: r.default_branch,
    language: r.language,
    stars: r.stargazers_count,
  }));
  reposCache.set(userId, { at: Date.now(), value: repos });
  return repos;
}
