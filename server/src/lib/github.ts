/**
 * Recent commits ("pushes") for a project's GitHub repo.
 *
 * Fetched server-side so the browser never touches GitHub directly:
 *  - the owner's OAuth token (if we have it) lifts the 60/h anonymous limit
 *    to 5000/h and makes private repos work for their owner;
 *  - a small in-memory cache (10 min) keeps profile views cheap.
 * Only public metadata is returned: sha, message headline, author, date, url.
 */

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
}

export interface RepoActivity {
  repo: RepoRef;
  commits: RepoCommit[];
  /** ISO of the newest commit — the project's "last push". */
  lastPushAt: string | null;
  fetchedAt: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: RepoActivity }>();

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

export async function fetchRepoActivity(
  ref: RepoRef,
  accessToken: string | null | undefined,
  limit = 10
): Promise<RepoActivity> {
  const key = `${ref.owner}/${ref.repo}:${limit}:${accessToken ? "auth" : "anon"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "vibehub",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = accessToken || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/commits?per_page=${limit}`,
    { headers, signal: AbortSignal.timeout(8000) }
  );

  if (!res.ok) {
    // 404 (private/nonexistent) and 403 (rate limit) both degrade to "no data"
    // rather than failing the page; the caller shows the repo link regardless.
    const empty: RepoActivity = { repo: ref, commits: [], lastPushAt: null, fetchedAt: new Date().toISOString() };
    if (res.status === 403 || res.status === 404) {
      cache.set(key, { at: Date.now(), value: empty });
      return empty;
    }
    throw new Error(`GitHub ${res.status}`);
  }

  const json = (await res.json()) as GithubCommitJson[];
  const commits: RepoCommit[] = json.map((c) => ({
    sha: c.sha,
    message: c.commit.message.split("\n")[0].slice(0, 200),
    authorName: c.commit.author?.name ?? null,
    authorLogin: c.author?.login ?? null,
    authorAvatarUrl: c.author?.avatar_url ?? null,
    committedAt: c.commit.author?.date ?? new Date(0).toISOString(),
    url: c.html_url,
  }));

  const value: RepoActivity = {
    repo: ref,
    commits,
    lastPushAt: commits[0]?.committedAt ?? null,
    fetchedAt: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
