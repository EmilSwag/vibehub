// Contract pins for project URLs and their actual create/PATCH schemas.
// Run from the repo root: npx tsx server/src/lib/__checks__/projectUrl.check.ts
// Plain assertions, no database, Prisma, server, credentials, or network calls.
// Exits non-zero (uncaught Error) when any expectation fails.

import { normalizeProjectUrl } from "../project-url";
import { createProjectSchema, patchProjectSchema } from "../schemas";

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

const FIELDS = ["repoUrl", "liveUrl"] as const;
const valid: [string, string, string][] = [
  ["shorthand", "octocat/Hello-World", "https://github.com/octocat/Hello-World"],
  ["shorthand punctuation", "owner_name/repo.v2", "https://github.com/owner_name/repo.v2"],
  ["shorthand trailing slash", "owner/repo/", "https://github.com/owner/repo"],
  ["GitHub without scheme", "github.com/owner/repo", "https://github.com/owner/repo"],
  ["www GitHub", "www.github.com/owner/repo", "https://www.github.com/owner/repo"],
  ["host wins over shorthand", "example.com/demo", "https://example.com/demo"],
  ["bare hostname", "example.dev", "https://example.dev"],
  ["subdomain", "docs.example.co.uk/start", "https://docs.example.co.uk/start"],
  ["hostname port", "example.com:8443/demo", "https://example.com:8443/demo"],
  ["query and fragment", "example.dev/demo?q=one#top", "https://example.dev/demo?q=one#top"],
  ["HTTPS kept", "https://example.com/demo", "https://example.com/demo"],
  ["HTTP kept", "http://example.com/demo", "http://example.com/demo"],
  ["case insensitive HTTP scheme", "HTTPS://GITHUB.COM/owner/repo/", "HTTPS://GITHUB.COM/owner/repo"],
  ["full URL trailing slash", "https://github.com/owner/repo/", "https://github.com/owner/repo"],
  ["outer whitespace", " \tgithub.com/owner/repo/\r\n", "https://github.com/owner/repo"],
  ["full .git kept", "https://github.com/owner/repo.git/", "https://github.com/owner/repo.git"],
  ["shorthand .git kept", "owner/repo.git/", "https://github.com/owner/repo.git"],
  ["www .git kept", "www.github.com/owner/repo.git/", "https://www.github.com/owner/repo.git"],
];

for (const [label, raw, expected] of valid) {
  eq(`normalize: ${label}`, normalizeProjectUrl(raw), expected);
  eq(`idempotent: ${label}`, normalizeProjectUrl(expected), expected);
  for (const field of FIELDS) {
    eq(`create ${field}: ${label}`, createProjectSchema.parse({ name: "Demo", [field]: raw })[field], expected);
    eq(`patch ${field}: ${label}`, patchProjectSchema.parse({ [field]: raw })[field], expected);
  }
}

// Empty and null are intentional clears on PATCH, absent URL values on CREATE.
for (const raw of ["", "   ", "\t\r\n", "\u00a0 "]) {
  eq(`normalize blank ${JSON.stringify(raw)}`, normalizeProjectUrl(raw), null);
  for (const field of FIELDS) {
    eq(`create blank ${field} ${JSON.stringify(raw)}`, createProjectSchema.parse({ name: "Demo", [field]: raw })[field], undefined);
    eq(`patch blank ${field} ${JSON.stringify(raw)}`, patchProjectSchema.parse({ [field]: raw })[field], null);
  }
}
eq("normalize null", normalizeProjectUrl(null), null);
eq("normalize undefined", normalizeProjectUrl(undefined), undefined);
for (const field of FIELDS) {
  eq(`create null ${field}`, createProjectSchema.parse({ name: "Demo", [field]: null })[field], undefined);
  eq(`patch null ${field}`, patchProjectSchema.parse({ [field]: null })[field], null);
  eq(`create undefined ${field}`, createProjectSchema.parse({ name: "Demo", [field]: undefined })[field], undefined);
  eq(`patch undefined ${field}`, patchProjectSchema.parse({ [field]: undefined })[field], undefined);
}
eq("create omitted URLs", createProjectSchema.parse({ name: "Demo" }), { name: "Demo" });
eq("PATCH omission does not clear", patchProjectSchema.parse({}), {});
eq("PATCH omitted repoUrl stays absent", Object.hasOwn(patchProjectSchema.parse({ liveUrl: "" }), "repoUrl"), false);
eq("PATCH omitted liveUrl stays absent", Object.hasOwn(patchProjectSchema.parse({ repoUrl: "" }), "liveUrl"), false);

// Non-strings must reach Zod unchanged, never become a URL or a silent omission.
const invalidTypes: unknown[] = [0, 42, false, true, {}, [], ["owner/repo"], new URL("https://example.com"), { toString: () => "owner/repo" }];
for (const [index, raw] of invalidTypes.entries()) {
  eq(`non-string ${index} identity`, Object.is(normalizeProjectUrl(raw), raw), true);
  for (const field of FIELDS) {
    eq(`create rejects non-string ${index} ${field}`, createProjectSchema.safeParse({ name: "Demo", [field]: raw }).success, false);
    eq(`patch rejects non-string ${index} ${field}`, patchProjectSchema.safeParse({ [field]: raw }).success, false);
  }
}

const otherSchemes = ["javascript:alert(1)", " JAVASCRIPT:alert(1) ", "ftp://example.com/repo/", "mailto:creator@example.com", "data:text/html,test", "file:///tmp/repo", "git+ssh://github.com/owner/repo"];
for (const raw of otherSchemes) eq(`non-HTTP scheme unchanged: ${raw}`, normalizeProjectUrl(raw), raw.trim());
const rejected = [
  ...otherSchemes,
  "./repo", "../repo", ".../repo", "owner/.", "owner/..", "owner/...", "../..",
  "owner", "owner/repo/extra", "/owner/repo", "//github.com/owner/repo", "not a url", "owner/repo name", "https:/example.com",
];
for (const raw of rejected) {
  for (const field of FIELDS) {
    eq(`create rejects ${field}: ${raw}`, createProjectSchema.safeParse({ name: "Demo", [field]: raw }).success, false);
    eq(`patch rejects ${field}: ${raw}`, patchProjectSchema.safeParse({ [field]: raw }).success, false);
  }
}
const scriptUrl = patchProjectSchema.safeParse({ repoUrl: "javascript:alert(1)" });
eq("javascript rejected by HTTP-only refine", !scriptUrl.success && scriptUrl.error.issues.some((issue) => issue.code === "custom" && issue.path[0] === "repoUrl"), true);

// The maximum applies to the normalized URL, including an automatically added scheme.
const prefix = "https://example.com/";
const maxUrl = prefix + "x".repeat(2048 - prefix.length);
for (const field of FIELDS) {
  for (const [label, raw] of [["full", maxUrl], ["without scheme", maxUrl.slice("https://".length)]]) {
    eq(`create accepts 2048 ${label} ${field}`, createProjectSchema.safeParse({ name: "Demo", [field]: raw }).success, true);
    eq(`patch accepts 2048 ${label} ${field}`, patchProjectSchema.safeParse({ [field]: raw }).success, true);
    eq(`create rejects 2049 ${label} ${field}`, createProjectSchema.safeParse({ name: "Demo", [field]: raw + "x" }).success, false);
    eq(`patch rejects 2049 ${label} ${field}`, patchProjectSchema.safeParse({ [field]: raw + "x" }).success, false);
  }
}

// Full payloads keep unrelated fields, and survive parse -> JSON -> parse unchanged.
const fullCreate = {
  name: "Demo", description: "A project", repoUrl: " owner/repo.git/ ", liveUrl: "www.example.com/demo/",
  coverImageUrl: "/uploads/projects/cover.png", imageUrls: ["/uploads/projects/cover.png", "https://example.com/shot.png"], isPublic: true,
};
const created = createProjectSchema.parse(fullCreate);
eq("full create schema", created, { ...fullCreate, repoUrl: "https://github.com/owner/repo.git", liveUrl: "https://www.example.com/demo" });
eq("full create schema round-trip", createProjectSchema.parse(JSON.parse(JSON.stringify(created))), created);
const fullPatch = { name: "Renamed", description: null, repoUrl: "", liveUrl: " \t ", coverImageUrl: null, imageUrls: [], isPublic: false };
const cleared = patchProjectSchema.parse(fullPatch);
eq("full PATCH clear schema", cleared, { ...fullPatch, repoUrl: null, liveUrl: null });
eq("full PATCH clear round-trip", patchProjectSchema.parse(JSON.parse(JSON.stringify(cleared))), cleared);
const updated = patchProjectSchema.parse({ repoUrl: "github.com/owner/next/", liveUrl: "example.dev/next/" });
eq("full PATCH URL update", updated, { repoUrl: "https://github.com/owner/next", liveUrl: "https://example.dev/next" });
eq("full PATCH URL update round-trip", patchProjectSchema.parse(JSON.parse(JSON.stringify(updated))), updated);
eq("create still requires name", createProjectSchema.safeParse({ repoUrl: "owner/repo" }).success, false);
eq("create still rejects empty name", createProjectSchema.safeParse({ name: "", repoUrl: "owner/repo" }).success, false);
eq("PATCH still rejects empty name", patchProjectSchema.safeParse({ name: "" }).success, false);
eq("image URLs are not subject to link leniency", patchProjectSchema.safeParse({ imageUrls: ["owner/repo"] }).success, false);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`projectUrl.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
