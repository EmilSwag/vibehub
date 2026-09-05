#!/usr/bin/env node
// Line-ending guard for shipped static assets.
//
// Why this exists: `railway up` uploads the *working tree*, not the git index. The
// repo normalizes to LF on commit (.gitattributes `* text=auto eol=lf`), so the
// committed blob of public/tracker/install.sh is always LF — but a Windows working
// copy rewritten by an editor or a tool can hold CRLF, and that copy is what gets
// uploaded and served. A CRLF install.sh is a hard failure for the people it targets:
// bash reads `set -euo pipefail\r` and dies with
//   ": invalid option nameipefail"
// which is what production served until this guard existed.
//
// Two modes, both wired into `npm run build` (the command Railway's Dockerfile runs):
//   --fix    rewrite the source assets under public/ to LF before Vite copies them
//   --check  assert the built dist/ contains no CR in any shipped shell script
// --check exits non-zero, which fails the Docker build, so a CRLF install.sh can no
// longer reach production even if --fix is bypassed or a new asset is added.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const CR = 0x0d;

// Assets that must ship LF-only. Shell scripts are the functional case; serve.json is
// here because it is plain text we author and there is no reason for it to carry CRLF.
const mustBeLf = (path) => path.endsWith(".sh") || path.endsWith("/serve.json");

// Deliberately NOT normalized:
//   *.ps1  — install.ps1 needs a UTF-8 BOM (Windows PowerShell 5.1 misreads BOM-less
//            UTF-8 via the system codepage and dies on the em-dashes); CRLF is the
//            native convention there and is not a defect. See the round 5 plan, Phase 6.
//   binaries (png/ico/woff/…) — CR bytes in those are data, not line endings.
const skip = (path) => path.endsWith(".ps1");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function targets(root) {
  if (!existsSync(root)) return [];
  return walk(root)
    .map((p) => p.split("\\").join("/"))
    .filter((p) => mustBeLf(p) && !skip(p));
}

const mode = process.argv[2] ?? "--check";

if (mode === "--fix") {
  const root = join(webRoot, "public");
  let changed = 0;
  for (const file of targets(root)) {
    const before = readFileSync(file);
    if (!before.includes(CR)) continue;
    const after = Buffer.from(before.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");
    writeFileSync(file, after);
    changed += 1;
    console.log(`[eol] normalized ${relative(webRoot, file)} (${before.length} -> ${after.length} bytes)`);
  }
  console.log(changed === 0 ? "[eol] sources already LF-only" : `[eol] normalized ${changed} file(s)`);
} else if (mode === "--check") {
  const root = join(webRoot, "dist");
  const required = join(root, "tracker/install.sh").split("\\").join("/");
  const failures = [];

  if (!existsSync(required)) {
    failures.push(`missing ${relative(webRoot, required)} — the installer must be in the build output`);
  }
  for (const file of targets(root)) {
    const buf = readFileSync(file);
    const cr = buf.filter((b) => b === CR).length;
    if (cr > 0) failures.push(`${relative(webRoot, file)} contains ${cr} CR byte(s) — must be LF-only`);
  }

  if (failures.length > 0) {
    console.error("[eol] BUILD FAILED — shipped scripts must be LF-only:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("[eol] run `node scripts/normalize-eol.mjs --fix` and rebuild.");
    process.exit(1);
  }
  const checked = targets(root).map((f) => relative(webRoot, f).split("\\").join("/"));
  console.log(`[eol] ok — LF-only confirmed in ${checked.length} shipped file(s): ${checked.join(", ")}`);
} else {
  console.error(`unknown mode ${mode} (expected --fix or --check)`);
  process.exit(2);
}
