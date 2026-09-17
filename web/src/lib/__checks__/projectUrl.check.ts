// Pure browser-compatible contract pins; discovered by scripts/run-checks.mjs.
import { githubRepoOf, isHttpUrl, normalizeProjectUrl } from "../projectUrl";

let passed = 0;
const failures: string[] = [];
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`ok   ${label} → ${a}`);
  } else {
    failures.push(label);
    console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
  }
}

const normalized: [string, string][] = [
  ["you/project", "https://github.com/you/project"],
  ["owner_name/repo.v2", "https://github.com/owner_name/repo.v2"],
  ["owner-name/repo_name", "https://github.com/owner-name/repo_name"],
  ["you/project.git", "https://github.com/you/project.git"],
  ["you/project/", "https://github.com/you/project"],
  [" \tyou/project\r\n", "https://github.com/you/project"],
  ["github.com/you/project", "https://github.com/you/project"],
  ["github.com/you/project/tree/main", "https://github.com/you/project/tree/main"],
  ["www.github.com/you/project", "https://www.github.com/you/project"],
  ["GITHUB.COM/You/Project.git/", "https://GITHUB.COM/You/Project.git/"],
  ["example.com/demo", "https://example.com/demo"],
  ["example.dev", "https://example.dev"],
  ["www.example.com", "https://www.example.com"],
  ["docs.example.co.uk/start", "https://docs.example.co.uk/start"],
  ["my-project.example.dev:8443/demo", "https://my-project.example.dev:8443/demo"],
  ["example.dev/demo?q=one#top", "https://example.dev/demo?q=one#top"],
  ["example.dev?q=one#top", "https://example.dev?q=one#top"],
  [" https://example.com/demo/ ", "https://example.com/demo/"],
  ["http://example.com/demo", "http://example.com/demo"],
  ["HTTPS://GITHUB.COM/You/Project/", "HTTPS://GITHUB.COM/You/Project/"],
  ["https://example.com/?path=/", "https://example.com/?path=/"],
];
for (const [raw, expected] of normalized) {
  eq(`normalize ${JSON.stringify(raw)}`, normalizeProjectUrl(raw), expected);
  eq(`idempotent ${JSON.stringify(raw)}`, normalizeProjectUrl(expected), expected);
  eq(`HTTP ${JSON.stringify(raw)}`, isHttpUrl(expected), true);
}
for (const blank of ["", " ", "\t\r\n", "\u00a0 "]) {
  eq(`blank ${JSON.stringify(blank)}`, normalizeProjectUrl(blank), null);
  eq(`blank is not a URL ${JSON.stringify(blank)}`, isHttpUrl(blank), false);
}

const invalid = [
  "javascript:alert(1)", " JAVASCRIPT:alert(1) ", "data:text/html,test",
  "ftp://example.com/repo/", "mailto:you@example.com", "file:///tmp/repo",
  "git+ssh://github.com/you/project", "not a url", "owner", "you/project name",
  "you/project/extra", "./repo", "../repo", ".../repo", "you/.", "you/..", "you/...",
  "/you/project", "//github.com/you/project", "https:/example.com", "https:example.com",
  "https://", "https://bad host/repo", "https://example.com:99999",
  "https://github.com\\you\\project", "https://exa\nmple.com",
];
for (const raw of invalid) {
  eq(`invalid unchanged ${JSON.stringify(raw)}`, normalizeProjectUrl(raw), raw.trim());
  eq(`invalid cannot submit ${JSON.stringify(raw)}`, isHttpUrl(normalizeProjectUrl(raw) ?? ""), false);
}

const repos: [string, { owner: string; repo: string }][] = [
  ["https://github.com/you/project", { owner: "you", repo: "project" }],
  ["http://github.com/you/project/", { owner: "you", repo: "project" }],
  ["https://www.github.com/you/project.git", { owner: "you", repo: "project" }],
  ["HTTPS://GITHUB.COM/You/Project.GIT/", { owner: "You", repo: "Project" }],
  ["https://github.com/you/project.git/tree/main/src", { owner: "you", repo: "project" }],
  ["https://github.com/you/project/blob/main/README.md?plain=1#readme", { owner: "you", repo: "project" }],
  ["https://github.com/owner_name/repo-name.v2?tab=readme-ov-file", { owner: "owner_name", repo: "repo-name.v2" }],
  [" https://github.com/you/project#readme ", { owner: "you", repo: "project" }],
  ["https://github.com/you/project.git.git", { owner: "you", repo: "project.git" }],
];
for (const [raw, expected] of repos) eq(`repo ${JSON.stringify(raw)}`, githubRepoOf(raw), expected);
for (const raw of [
  null, undefined, "", "you/project", "github.com/you/project", "not a url",
  "https://github.com", "https://github.com/you", "https://github.com/you/",
  "https://gitlab.com/you/project", "https://github.com.evil.test/you/project",
  "https://notgithub.com/you/project", "https://gist.github.com/you/project",
  "ftp://github.com/you/project", "javascript:alert(1)", "//github.com/you/project",
  "https://user:secret@github.com/you/project", "https://github.com@evil.test/you/project",
  "https://github.com/you//project", "https://github.com/you/.git",
  "https://github.com/.../project", "https://github.com/you/...",
  "https://github.com/you/%20project", "https://github.com/you/..",
]) eq(`not a GitHub repo ${JSON.stringify(raw)}`, githubRepoOf(raw), null);
eq("normalized draft repo", githubRepoOf(normalizeProjectUrl("github.com/you/project")), { owner: "you", repo: "project" });
eq("a hostname is never GitHub shorthand", githubRepoOf(normalizeProjectUrl("example.com/demo")), null);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) throw new Error(`projectUrl.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
