// Contract pins for lib/mac-release.ts - plain assertions, no test framework.
// Run from the repo root:  npx tsx server/src/lib/__checks__/macRelease.check.ts
// Exits non-zero (uncaught Error) when any expectation fails.
//
// This is what `GET /api/v1/mac/latest` hands the web download tab and mac.sh, so which
// release is "latest" and what the sha256 line parses to are both load-bearing.

import { buildMacLatestPayload, compareMacVersions, MAC_PKG_ASSET, MAC_SHA256_ASSET, MAC_ZIP_ASSET, parseMacVersion, parseSha256, pickMacRelease, type GithubReleaseListJson } from "../mac-release";

let passed = 0;
const failures: string[] = [];

function eq<T>(label: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`ok   ${label} -> ${a}`);
  } else {
    failures.push(label);
    console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
  }
}

const HEX = "a".repeat(32) + "0123456789abcdef0123456789abcdef";

// ---- tags ----
eq("mac-v1.0.0", parseMacVersion("mac-v1.0.0"), [1, 0, 0]);
eq("mac-v1.2", parseMacVersion("mac-v1.2"), [1, 2]);
eq("mac-v10.20.30", parseMacVersion("mac-v10.20.30"), [10, 20, 30]);
for (const bad of ["v1.0.0", "mac-1.0.0", "mac-v", "mac-v1.0.0-rc1", "mac-v1.0.0 ", "mac-vX", "menubar-v1.0.0", "", null, 1]) {
  eq(`not a mac tag: ${JSON.stringify(bad)}`, parseMacVersion(bad), null);
}
eq("1.2.3 vs 1.2.10", Math.sign(compareMacVersions([1, 2, 3], [1, 2, 10])), -1);
eq("1.2 == 1.2.0", compareMacVersions([1, 2], [1, 2, 0]), 0);
eq("2.0 > 1.99.99", Math.sign(compareMacVersions([2, 0], [1, 99, 99])), 1);

// ---- picking ----
const release = (tag: string, assets: string[], extra: Partial<GithubReleaseListJson> = {}): GithubReleaseListJson => ({
  tag_name: tag,
  published_at: "2026-09-19T10:00:00Z",
  assets: assets.map((name) => ({ name, browser_download_url: `https://github.com/EmilSwag/vibehub/releases/download/${tag}/${name}` })),
  ...extra,
});
const full = (tag: string, extra: Partial<GithubReleaseListJson> = {}) => release(tag, [MAC_PKG_ASSET, MAC_SHA256_ASSET, MAC_ZIP_ASSET], extra);

eq("no releases", pickMacRelease([]), null);
eq("only other tags", pickMacRelease([full("v1.0.0"), full("menubar-v0.1.0")]), null);
eq("picks the only candidate, with every asset URL", pickMacRelease([full("mac-v1.0.0")]), {
  tag: "mac-v1.0.0",
  version: "1.0.0",
  publishedAt: "2026-09-19T10:00:00Z",
  pkgUrl: "https://github.com/EmilSwag/vibehub/releases/download/mac-v1.0.0/VibeHub.pkg",
  sha256Url: "https://github.com/EmilSwag/vibehub/releases/download/mac-v1.0.0/VibeHub.pkg.sha256",
  zipUrl: "https://github.com/EmilSwag/vibehub/releases/download/mac-v1.0.0/VibeHub-macOS.zip",
});
eq(
  "highest version wins, not the most recently published",
  pickMacRelease([full("mac-v1.0.1", { published_at: "2026-09-20T00:00:00Z" }), full("mac-v1.1.0", { published_at: "2026-09-10T00:00:00Z" })])?.tag,
  "mac-v1.1.0"
);
eq("GitHub's list order does not matter", pickMacRelease([full("mac-v1.0.0"), full("mac-v1.2.0"), full("mac-v1.1.0")])?.tag, "mac-v1.2.0");
eq("drafts are skipped", pickMacRelease([full("mac-v2.0.0", { draft: true }), full("mac-v1.0.0")])?.tag, "mac-v1.0.0");
eq("prereleases are skipped", pickMacRelease([full("mac-v2.0.0", { prerelease: true }), full("mac-v1.0.0")])?.tag, "mac-v1.0.0");
eq("a release without the pkg asset is skipped", pickMacRelease([release("mac-v2.0.0", [MAC_ZIP_ASSET]), full("mac-v1.0.0")])?.tag, "mac-v1.0.0");
eq("sha256 and zip are optional", pickMacRelease([release("mac-v1.0.0", [MAC_PKG_ASSET])]), {
  tag: "mac-v1.0.0",
  version: "1.0.0",
  publishedAt: "2026-09-19T10:00:00Z",
  pkgUrl: "https://github.com/EmilSwag/vibehub/releases/download/mac-v1.0.0/VibeHub.pkg",
  sha256Url: null,
  zipUrl: null,
});
eq("missing published_at is null", pickMacRelease([full("mac-v1.0.0", { published_at: null })])?.publishedAt, null);
eq("same version twice: the later publish wins", pickMacRelease([full("mac-v1.0.0", { published_at: "2026-09-01T00:00:00Z" }), full("mac-v1.0.0", { published_at: "2026-09-02T00:00:00Z" })])?.publishedAt, "2026-09-02T00:00:00Z");
eq("malformed entries are ignored", pickMacRelease([null as unknown as GithubReleaseListJson, { tag_name: "mac-v1.0.0" }, full("mac-v0.9.0")])?.tag, "mac-v0.9.0");

// ---- sha256 ----
eq("bare hex line (what make-pkg.sh writes)", parseSha256(`${HEX}\n`), HEX);
eq("classic shasum format", parseSha256(`${HEX}  VibeHub.pkg\n`), HEX);
eq("upper-case is normalised", parseSha256(HEX.toUpperCase()), HEX);
eq("65 hex chars is not a digest", parseSha256(`${HEX}0`), null);
eq("63 hex chars is not a digest", parseSha256(HEX.slice(1)), null);
eq("HTML error page is not a digest", parseSha256("<html>Not Found</html>"), null);
eq("empty", parseSha256(""), null);
eq("non-string", parseSha256(undefined), null);

// ---- payload ----
const candidate = pickMacRelease([full("mac-v1.0.0")])!;
eq("payload keys, in order", Object.keys(buildMacLatestPayload(candidate, HEX)), ["version", "tag", "pkgUrl", "sha256", "zipUrl", "publishedAt"]);
eq("payload carries the digest, not the digest URL", buildMacLatestPayload(candidate, HEX).sha256, HEX);
eq("payload sha256 is null when the asset could not be read", buildMacLatestPayload(candidate, null).sha256, null);

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`macRelease.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
