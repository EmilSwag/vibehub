#!/usr/bin/env node
// Encoding guard for shipped static assets: line endings, and .ps1 text encoding.
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
// Round 10 added the second rule, for the same class of bug one platform over: a
// .ps1 that is served with a UTF-8 BOM breaks `irm … | iex`, the documented way to
// run install.ps1 on Windows. See ps1EncodingFailures below.
//
// Two modes, both wired into `npm run build` (the command Railway's Dockerfile runs):
//   --fix    rewrite the source assets under public/ to LF, and strip any .ps1 BOM,
//            before Vite copies them
//   --check  assert the built dist/ contains no CR in any shipped shell script, and
//            that every .ps1 in public/ and dist/ is ASCII with no BOM
// --check exits non-zero, which fails the Docker build, so neither a CRLF install.sh
// nor a BOM'd install.ps1 can reach production even if --fix is bypassed or a new
// asset is added.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const CR = 0x0d;

// Assets that must ship LF-only. Shell scripts are the functional case; serve.json is
// here because it is plain text we author and there is no reason for it to carry CRLF.
const mustBeLf = (path) => path.endsWith(".sh") || path.endsWith("/serve.json");

// Deliberately NOT normalized:
//   *.ps1  — CRLF is the native line ending on Windows and is not a defect there.
//            Their *encoding* is policed instead — see ps1EncodingFailures below.
//   binaries (png/ico/woff/…) — CR bytes in those are data, not line endings.
const skip = (path) => path.endsWith(".ps1");

const isPs1 = (path) => path.endsWith(".ps1");
const BOM = [0xef, 0xbb, 0xbf];
const hasBom = (buf) => buf.length >= 3 && BOM.every((b, i) => buf[i] === b);

// Round 10 (W1): every .ps1 we serve must be ASCII with no BOM.
//
// install.ps1 shipped with a UTF-8 BOM for months — correct, once, for a version that
// contained em-dashes, because PS 5.1 decodes a BOM-less script *file* through the
// system codepage. The em-dashes went; the BOM stayed. But the documented way to run
// this file is `irm … | iex`, which hands PowerShell a string, not a file: the BOM
// arrives as U+FEFF welded to the first token, so every real install on Windows opened
// with a red
//   ?# : The term "?#" is not recognized as the name of a cmdlet...
// before going on to work. Measured on a real prod install, round 10.
//
// Both halves of the rule are load-bearing: no BOM keeps `irm | iex` clean, and
// ASCII-only keeps `-File` correct without one. Neither is checkable by eye, so the
// build checks it.
function ps1EncodingFailures(file) {
  const buf = readFileSync(file);
  const out = [];
  const name = relative(webRoot, file).split("\\").join("/");
  if (hasBom(buf)) {
    out.push(`${name} starts with a UTF-8 BOM — \`irm … | iex\` feeds it to the parser as part of the first token`);
  }
  const body = hasBom(buf) ? buf.subarray(3) : buf;
  const bad = body.findIndex((b) => b > 0x7f);
  if (bad !== -1) {
    out.push(`${name} has a non-ASCII byte at offset ${hasBom(buf) ? bad + 3 : bad} (0x${body[bad].toString(16)}) — a BOM-less .ps1 must be pure ASCII to survive PS 5.1's codepage`);
  }
  return out;
}

function ps1Files(root) {
  if (!existsSync(root)) return [];
  return walk(root)
    .map((p) => p.split("\\").join("/"))
    .filter(isPs1);
}

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
  // A BOM is the one encoding defect that can be fixed without guessing what the
  // author meant; a stray non-ASCII byte is a judgement call and is only reported.
  for (const file of ps1Files(root)) {
    const buf = readFileSync(file);
    if (!hasBom(buf)) continue;
    writeFileSync(file, buf.subarray(3));
    changed += 1;
    console.log(`[eol] stripped the UTF-8 BOM from ${relative(webRoot, file)} (${buf.length} -> ${buf.length - 3} bytes)`);
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

  // Checked in BOTH roots: public/ is what an author edits and what `railway up`
  // uploads, dist/ is what is actually served. A BOM in either one is a broken
  // install on a real Windows machine.
  const ps1 = [join(webRoot, "public"), root].flatMap(ps1Files);
  for (const file of ps1) failures.push(...ps1EncodingFailures(file));

  if (failures.length > 0) {
    console.error("[eol] BUILD FAILED — shipped scripts must be LF-only, and .ps1 ASCII without a BOM:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("[eol] run `node scripts/normalize-eol.mjs --fix` and rebuild.");
    process.exit(1);
  }
  const checked = targets(root).map((f) => relative(webRoot, f).split("\\").join("/"));
  console.log(`[eol] ok — LF-only confirmed in ${checked.length} shipped file(s): ${checked.join(", ")}`);
  const ps1Names = ps1.map((f) => relative(webRoot, f).split("\\").join("/"));
  console.log(`[eol] ok — ASCII, no BOM in ${ps1Names.length} PowerShell script(s): ${ps1Names.join(", ")}`);
} else {
  console.error(`unknown mode ${mode} (expected --fix or --check)`);
  process.exit(2);
}
