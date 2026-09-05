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

/** One directory level of the repo, as the round-7 project-page file browser shows it. */
export interface RepoEntry {
  name: string;
  type: "dir" | "file";
  /** Byte size for files; null for directories (GitHub reports 0, which would read as "empty"). */
  size: number | null;
  /** github.com URL for the entry — the browser links every row out. */
  url: string;
}

export interface RepoTree {
  defaultBranch: string;
  /** The normalized subpath this listing is for; "" is the repo root. */
  path: string;
  entries: RepoEntry[];
}

export interface RepoLanguage {
  name: string;
  /** Fraction of the repo's bytes, 0–1, rounded to 4 dp. Sorted biggest first. */
  share: number;
}

export interface RepoReadme {
  /** ~600 chars of the README with markdown syntax stripped — plain text, no links. */
  excerpt: string;
  url: string;
}

const COMMITS_CACHE_TTL_MS = 10 * 60 * 1000;
const REPO_BROWSE_CACHE_TTL_MS = 10 * 60 * 1000;
const REPOS_CACHE_TTL_MS = 5 * 60 * 1000;
const GITHUB_TIMEOUT_MS = 8000;
const MAX_COMMITS_WITH_STATS = 30;
/** Directory listings are one screen of a file browser, not a repo dump. */
const MAX_TREE_ENTRIES = 300;
const README_EXCERPT_CHARS = 600;

const commitsCache = new Map<string, { at: number; value: RepoActivity }>();
const reposCache = new Map<string, { at: number; value: GithubRepoSummary[] }>();
const treeCache = new Map<string, { at: number; value: RepoTree }>();
const languagesCache = new Map<string, { at: number; value: RepoLanguage[] | null }>();
const readmeCache = new Map<string, { at: number; value: RepoReadme | null }>();

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

// ---------------------------------------------------------------------------------
// Round 7 — repo browser for the project page (`GET /projects/:id/repo`).
//
// Same three rules as the commit list above: the owner's (refreshed) token first so a
// private repo works for its owner, an 8 s timeout on every call, and a 10-minute
// cache keyed by (repo, path, auth-or-anon) so a visitor clicking through folders
// doesn't spend the project owner's GitHub rate limit twice on the same directory.
//
// The difference is error handling. A commit list may quietly degrade to "no commits"
// — the card still means something without it. A *file browser* that silently shows an
// empty repo is a lie, so the two outcomes are separated into typed errors and the
// route turns them into an honest 404 (no such repo/path) or 503 (GitHub is busy —
// try again), never into an empty listing.
// ---------------------------------------------------------------------------------

/** GitHub has no such repo, path, or README (404) — the route maps this to its own 404. */
export class GithubNotFoundError extends Error {}

/** Rate-limited, 5xx, or unreachable — the route maps this to 503 `github_unavailable`. */
export class GithubUnavailableError extends Error {}

function githubFailure(status: number): Error {
  return status === 404 ? new GithubNotFoundError("GitHub 404") : new GithubUnavailableError(`GitHub ${status}`);
}

/** fetch + the shared timeout, with network/timeout failures already classified. */
async function githubFetch(url: string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) });
  } catch {
    throw new GithubUnavailableError("GitHub unreachable");
  }
}

function browseCacheKey(ref: RepoRef, accessToken: string | null | undefined, suffix = ""): string {
  return `${ref.owner}/${ref.repo}:${suffix}:${accessToken ? "auth" : "anon"}`;
}

const repoMetaCache = new Map<string, { at: number; value: { defaultBranch: string } }>();

/** `default_branch` only — cached separately so browsing N folders costs one call, not N. */
async function fetchRepoMeta(
  ref: RepoRef,
  accessToken: string | null | undefined
): Promise<{ defaultBranch: string }> {
  const key = browseCacheKey(ref, accessToken);
  const hit = repoMetaCache.get(key);
  if (hit && Date.now() - hit.at < REPO_BROWSE_CACHE_TTL_MS) return hit.value;

  const res = await githubFetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, authHeaders(accessToken));
  if (!res.ok) throw githubFailure(res.status);
  const json = (await res.json()) as { default_branch?: string };
  const value = { defaultBranch: json.default_branch || "main" };
  repoMetaCache.set(key, { at: Date.now(), value });
  return value;
}

interface GithubContentJson {
  name: string;
  type: string;
  size?: number;
  html_url: string | null;
}

/**
 * One directory level of the repo's default branch — `path` "" is the root.
 *
 * Throws GithubNotFoundError when the repo or path doesn't exist (including when
 * `path` names a *file*: GitHub answers with an object rather than a list, and there
 * is nothing to browse), GithubUnavailableError on a rate limit or outage.
 */
export async function fetchRepoTree(
  ref: RepoRef,
  accessToken: string | null | undefined,
  path = ""
): Promise<RepoTree> {
  const key = browseCacheKey(ref, accessToken, `tree:${path}`);
  const hit = treeCache.get(key);
  if (hit && Date.now() - hit.at < REPO_BROWSE_CACHE_TTL_MS) return hit.value;

  const headers = authHeaders(accessToken);
  const encoded = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const [meta, contentsRes] = await Promise.all([
    fetchRepoMeta(ref, accessToken),
    // No `?ref=` — GitHub serves the default branch, which is exactly what we browse.
    githubFetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/contents/${encoded}`, headers),
  ]);
  if (!contentsRes.ok) throw githubFailure(contentsRes.status);

  const listing = (await contentsRes.json()) as GithubContentJson[] | GithubContentJson;
  if (!Array.isArray(listing)) throw new GithubNotFoundError("Not a directory");

  const entries: RepoEntry[] = listing
    .map((e) => ({
      name: e.name,
      type: e.type === "dir" ? ("dir" as const) : ("file" as const),
      // GitHub reports 0 for directories, which a UI would render as "empty".
      size: e.type === "dir" || typeof e.size !== "number" ? null : e.size,
      url: e.html_url || `https://github.com/${ref.owner}/${ref.repo}`,
    }))
    .sort((a, b) =>
      a.type === b.type
        ? a.name.localeCompare(b.name, "en", { sensitivity: "base" })
        : a.type === "dir"
          ? -1
          : 1
    )
    .slice(0, MAX_TREE_ENTRIES);

  const value: RepoTree = { defaultBranch: meta.defaultBranch, path, entries };
  treeCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Language breakdown as shares of total bytes, biggest first — null when GitHub has no
 * numbers for the repo or is having a bad day. Never throws: the languages bar is
 * decoration on top of the file list, so it degrades instead of failing the page.
 */
export async function fetchRepoLanguages(
  ref: RepoRef,
  accessToken: string | null | undefined
): Promise<RepoLanguage[] | null> {
  const key = browseCacheKey(ref, accessToken, "languages");
  const hit = languagesCache.get(key);
  if (hit && Date.now() - hit.at < REPO_BROWSE_CACHE_TTL_MS) return hit.value;

  let res: Response;
  try {
    res = await githubFetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/languages`, authHeaders(accessToken));
  } catch {
    return null; // transient — deliberately not cached, so the bar comes back on retry
  }
  if (res.status === 404) {
    languagesCache.set(key, { at: Date.now(), value: null });
    return null;
  }
  if (!res.ok) return null;

  const json = (await res.json().catch(() => ({}))) as Record<string, number>;
  const pairs = Object.entries(json).filter(([, bytes]) => typeof bytes === "number" && bytes > 0);
  const total = pairs.reduce((sum, [, bytes]) => sum + bytes, 0);
  const value =
    total > 0
      ? pairs
          .map(([name, bytes]) => ({ name, share: Math.round((bytes / total) * 10000) / 10000 }))
          .sort((a, b) => b.share - a.share)
      : null;
  languagesCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Markdown → plain text, good enough for a two-line preview: code fences, badges,
 * images, HTML and link syntax go away and the visible words stay. Not a parser and
 * not trying to be — anything it misses is at worst a stray character in an excerpt.
 */
function stripMarkdown(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, "\n")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/~~~[\s\S]*?~~~/g, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Badges and images before links — they are link syntax with a leading "!".
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/!\[[^\]]*\]\[[^\]]*\]/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
      .replace(/^\s*\[[^\]]+\]:.*$/gm, " ")
      // READMEs open with raw HTML more often than not (<h1 align="center"><img …>).
      .replace(/<[^>]+>/g, " ")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm, " ")
      .replace(/^\s*([-*+]|\d+[.)])\s+/gm, "")
      .replace(/\|/g, " ")
      .replace(/`+/g, "")
      .replace(/(\*\*|__)([\s\S]*?)\1/g, "$2")
      // Single "*" only: a lone "_" is far more often snake_case than italics.
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/~~([\s\S]*?)~~/g, "$1")
      // Markdown backslash-escapes ("Docs \& Community") — CommonMark only allows them
      // before ASCII punctuation, of which "not a word character" is a safe superset.
      .replace(/\\([^\w\s])/g, "$1")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Truncate on a word boundary when there is a sensible one nearby. */
function clampExcerpt(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * First ~600 characters of the repo README as plain text, plus the github.com link to
 * read the rest. null when the repo has no README (or GitHub is unavailable) — like
 * the languages bar this never throws, the file list is the part that must render.
 */
export async function fetchReadmeExcerpt(
  ref: RepoRef,
  accessToken: string | null | undefined
): Promise<RepoReadme | null> {
  const key = browseCacheKey(ref, accessToken, "readme");
  const hit = readmeCache.get(key);
  if (hit && Date.now() - hit.at < REPO_BROWSE_CACHE_TTL_MS) return hit.value;

  let res: Response;
  try {
    res = await githubFetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/readme`, authHeaders(accessToken));
  } catch {
    return null;
  }
  if (res.status === 404) {
    readmeCache.set(key, { at: Date.now(), value: null });
    return null;
  }
  if (!res.ok) return null;

  const json = (await res.json().catch(() => ({}))) as {
    content?: string;
    encoding?: string;
    html_url?: string | null;
  };
  if (!json.content || json.encoding !== "base64") return null;

  const excerpt = clampExcerpt(stripMarkdown(Buffer.from(json.content, "base64").toString("utf8")), README_EXCERPT_CHARS);
  const value: RepoReadme | null = excerpt
    ? { excerpt, url: json.html_url || `https://github.com/${ref.owner}/${ref.repo}#readme` }
    : null;
  readmeCache.set(key, { at: Date.now(), value });
  return value;
}
