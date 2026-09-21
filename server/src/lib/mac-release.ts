/**
 * `GET /api/v1/mac/latest` - which GitHub Release is "the current VibeHub for Mac".
 *
 * The mac workflow (`.github/workflows/mac.yml`) cuts a Release for every `mac-v*` tag
 * with three assets attached: `VibeHub.pkg` (the installer), `VibeHub.pkg.sha256` (one
 * bare hex line - `shasum -a 256 | awk '{print $1}'` in `mac/scripts/make-pkg.sh`) and
 * `VibeHub-macOS.zip` (the app on its own). The web's download tab and the one-command
 * installer (`web/public/tracker/mac.sh`) both ask this server for the newest one
 * instead of hard-coding a URL, so a release is live the moment CI publishes it.
 *
 * This file is the pure half - picking and parsing - and is Prisma/network-free so
 * `__checks__/macRelease.check.ts` can pin it. The fetch + 10-minute cache live in
 * `routes/mac.ts`.
 */

export const MAC_TAG_PREFIX = "mac-v";
export const MAC_PKG_ASSET = "VibeHub.pkg";
export const MAC_SHA256_ASSET = "VibeHub.pkg.sha256";
export const MAC_ZIP_ASSET = "VibeHub-macOS.zip";

/** The subset of GitHub's `GET /repos/{owner}/{repo}/releases` list entry this reads. */
export interface GithubReleaseListJson {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets?: { name: string; browser_download_url: string }[];
}

export interface MacReleaseCandidate {
  tag: string;
  /** `mac-v1.2.3` -> `1.2.3` (matches `CFBundleShortVersionString`, which make-pkg.sh reads). */
  version: string;
  publishedAt: string | null;
  pkgUrl: string;
  /** Download URL of the `.sha256` asset - its *contents* are the payload's `sha256`. */
  sha256Url: string | null;
  zipUrl: string | null;
}

/** The wire shape (ARCHITECTURE.md §5.10). `sha256`/`zipUrl` are null only for a hand-made release missing that asset. */
export interface MacLatestPayload {
  version: string;
  tag: string;
  pkgUrl: string;
  sha256: string | null;
  zipUrl: string | null;
  publishedAt: string | null;
}

/**
 * `mac-v<digits>(.<digits>)*` -> numeric parts, else null. Anything with a suffix
 * (`mac-v1.2.0-rc1`) is deliberately not a release this endpoint will ever hand to an
 * installer - the same conservative rule as skipping GitHub's own `prerelease` flag.
 */
export function parseMacVersion(tag: unknown): number[] | null {
  if (typeof tag !== "string" || !tag.startsWith(MAC_TAG_PREFIX)) return null;
  const rest = tag.slice(MAC_TAG_PREFIX.length);
  if (!/^\d+(\.\d+)*$/.test(rest)) return null;
  return rest.split(".").map((part) => Number(part));
}

/** Numeric, part by part; a missing part is 0 (`1.2` == `1.2.0`). */
export function compareMacVersions(a: readonly number[], b: readonly number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function assetUrl(release: GithubReleaseListJson, name: string): string | null {
  const asset = release.assets?.find((entry) => entry && entry.name === name);
  return asset && typeof asset.browser_download_url === "string" && asset.browser_download_url ? asset.browser_download_url : null;
}

/**
 * The newest installable `mac-v*` release out of GitHub's list, or null. Highest
 * version wins (not most recently published - a re-cut `mac-v1.0.1` after `mac-v1.1.0`
 * must not become "latest"); drafts, prereleases, unparseable tags and releases without
 * a `VibeHub.pkg` asset are skipped.
 */
export function pickMacRelease(releases: readonly GithubReleaseListJson[]): MacReleaseCandidate | null {
  let best: { version: number[]; candidate: MacReleaseCandidate } | null = null;
  for (const release of releases) {
    if (!release || release.draft || release.prerelease) continue;
    const version = parseMacVersion(release.tag_name);
    if (!version) continue;
    const pkgUrl = assetUrl(release, MAC_PKG_ASSET);
    if (!pkgUrl) continue;
    const candidate: MacReleaseCandidate = {
      tag: release.tag_name,
      version: version.join("."),
      publishedAt: typeof release.published_at === "string" ? release.published_at : null,
      pkgUrl,
      sha256Url: assetUrl(release, MAC_SHA256_ASSET),
      zipUrl: assetUrl(release, MAC_ZIP_ASSET),
    };
    const order = best ? compareMacVersions(version, best.version) : 1;
    const newer = order > 0 || (order === 0 && (candidate.publishedAt ?? "") > (best?.candidate.publishedAt ?? ""));
    if (newer) best = { version, candidate };
  }
  return best?.candidate ?? null;
}

/**
 * The digest out of a `.sha256` asset: the first 64-hex token, lower-cased, so both the
 * bare line make-pkg.sh writes and the classic `<hex>  VibeHub.pkg` shasum format work.
 */
export function parseSha256(text: unknown): string | null {
  if (typeof text !== "string" || text.length > 4096) return null;
  const match = /(?:^|[^0-9a-f])([0-9a-f]{64})(?![0-9a-f])/i.exec(text);
  return match ? match[1].toLowerCase() : null;
}

export function buildMacLatestPayload(candidate: MacReleaseCandidate, sha256: string | null): MacLatestPayload {
  return {
    version: candidate.version,
    tag: candidate.tag,
    pkgUrl: candidate.pkgUrl,
    sha256,
    zipUrl: candidate.zipUrl,
    publishedAt: candidate.publishedAt,
  };
}
