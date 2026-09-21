import { Router } from "express";
import { env } from "../env";
import { authHeaders } from "../lib/github";
import { asyncHandler, HttpError } from "../lib/http-error";
import { buildMacLatestPayload, parseSha256, pickMacRelease, type GithubReleaseListJson, type MacLatestPayload } from "../lib/mac-release";

// `GET /api/v1/mac/latest` - ARCHITECTURE.md §5.10. Unauthenticated: the web's download
// tab and the one-command installer (`curl ... | bash`) both call it before a user has
// any token. Reads GitHub with the server's `GITHUB_TOKEN` (via `authHeaders`, the same
// fallback chain project cards use) so the public 60 req/h anonymous limit is never what
// stands between someone and the installer.

const router = Router();

const CACHE_TTL_MS = 10 * 60 * 1000;
/** "No release yet" is re-checked sooner - the first tag should show up promptly. */
const NEGATIVE_TTL_MS = 60 * 1000;
const GITHUB_TIMEOUT_MS = 8000;
const RELEASES_PAGE_SIZE = 30;

let cache: { at: number; value: MacLatestPayload | null } | null = null;

/** `owner/repo` from `MAC_RELEASE_REPO`, validated the way parseGithubRepoUrl validates a URL. */
function releaseRepo(): { owner: string; repo: string } {
  const [owner, repo, ...rest] = env.macReleaseRepo.split("/");
  if (!owner || !repo || rest.length > 0 || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    throw new HttpError(503, "mac_release_repo_invalid");
  }
  return { owner, repo };
}

async function fetchSha256(url: string, headers: Record<string, string>): Promise<string | null> {
  try {
    // Asset downloads redirect to objects.githubusercontent.com; fetch follows that.
    const res = await fetch(url, {
      headers: { ...headers, Accept: "application/octet-stream" },
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseSha256(await res.text());
  } catch {
    return null;
  }
}

/**
 * Newest installable release, cached 10 minutes; `null` = no `mac-v*` release exists
 * (cached 60 s). Throws 503 when GitHub is unreachable and nothing is cached - a stale
 * cached answer is served in preference to an error, since an installer link that is
 * ten minutes old is still a correct installer link.
 */
async function fetchMacLatest(): Promise<MacLatestPayload | null> {
  const now = Date.now();
  if (cache && now - cache.at < (cache.value ? CACHE_TTL_MS : NEGATIVE_TTL_MS)) return cache.value;

  const { owner, repo } = releaseRepo();
  const headers = authHeaders(null);
  let releases: GithubReleaseListJson[];
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=${RELEASES_PAGE_SIZE}`, {
      headers,
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const json = (await res.json()) as unknown;
    releases = Array.isArray(json) ? (json as GithubReleaseListJson[]) : [];
  } catch (err) {
    if (cache) {
      console.warn(`[mac] GitHub releases unavailable (${err instanceof Error ? err.message : "error"}); serving the cached answer`);
      return cache.value;
    }
    throw new HttpError(503, "github_unavailable");
  }

  const candidate = pickMacRelease(releases);
  if (!candidate) {
    cache = { at: Date.now(), value: null };
    return null;
  }
  const sha256 = candidate.sha256Url ? await fetchSha256(candidate.sha256Url, headers) : null;
  const value = buildMacLatestPayload(candidate, sha256);
  cache = { at: Date.now(), value };
  return value;
}

router.get(
  "/mac/latest",
  asyncHandler(async (req, res) => {
    const latest = await fetchMacLatest();
    if (!latest) throw new HttpError(404, "no_release");

    const redirect = typeof req.query.redirect === "string" ? req.query.redirect : "";
    if (redirect) {
      // `?redirect=pkg` is what a browser "Download" button and `curl -L` want: one URL
      // that is always the newest installer. The Location is GitHub's own asset URL.
      const target = redirect === "pkg" ? latest.pkgUrl : redirect === "zip" ? latest.zipUrl : undefined;
      if (target === undefined) throw new HttpError(400, "bad_redirect");
      if (target === null) throw new HttpError(404, "no_zip");
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, target);
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(latest);
  })
);

export default router;
