#!/usr/bin/env node
// Runs every contract-pin check under src/lib/__checks__ and reports one total.
//
// The checks are plain assertion scripts, not a test framework: each one prints its own
// "N passed, M failed" and throws on failure (see any *.check.ts header). That works fine
// one file at a time, which is how they were run — five commands, five totals, and no
// single answer to "is the web side green?". This is that answer.
//
//   node scripts/run-checks.mjs          all of them
//   node scripts/run-checks.mjs tracker  only files whose name contains "tracker"
//
// Exits non-zero if any check fails or if a file's total cannot be read, so it is safe
// to put in front of a build.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const checksDir = join(webRoot, "src", "lib", "__checks__");
const filter = process.argv[2] ?? "";

const files = readdirSync(checksDir)
  .filter((name) => name.endsWith(".check.ts"))
  .filter((name) => name.toLowerCase().includes(filter.toLowerCase()))
  .sort();

if (files.length === 0) {
  console.error(filter ? `[checks] no check files match "${filter}"` : "[checks] no check files found");
  process.exit(2);
}

// The last "N passed, M failed" a check prints is its summary.
const TOTALS = /(\d+) passed, (\d+) failed/g;

let passed = 0;
let failed = 0;
const broken = [];

for (const name of files) {
  const file = join(checksDir, name);
  // `node --import tsx` rather than the tsx shim: no .cmd indirection on Windows, and
  // the same invocation the tracker's suite uses.
  const run = spawnSync(process.execPath, ["--import", "tsx", file], {
    cwd: webRoot,
    encoding: "utf8",
    timeout: 300_000,
  });
  const out = `${run.stdout ?? ""}`;
  const matches = [...out.matchAll(TOTALS)];
  const last = matches.at(-1);

  if (!last) {
    broken.push(`${name}: printed no total (exit ${run.status})`);
    const detail = `${run.stderr ?? ""}`.trim().split("\n").slice(-3).join("\n       ");
    console.log(`  ??   ${name.padEnd(26)} no total${detail ? `\n       ${detail}` : ""}`);
    continue;
  }

  const filePassed = Number(last[1]);
  const fileFailed = Number(last[2]);
  passed += filePassed;
  failed += fileFailed;

  // A check that fails throws after printing its total, so a non-zero exit with 0
  // failures counted means something else went wrong and must not read as green.
  if (run.status !== 0 && fileFailed === 0) {
    broken.push(`${name}: exited ${run.status} without reporting a failure`);
  }
  const mark = fileFailed === 0 && run.status === 0 ? "ok  " : "FAIL";
  console.log(`  ${mark} ${name.padEnd(26)} ${filePassed} passed, ${fileFailed} failed`);
  if (fileFailed > 0) {
    for (const line of out.split("\n").filter((l) => l.startsWith("FAIL "))) console.log(`       ${line}`);
  }
}

console.log(`\n${relative(webRoot, checksDir).split("\\").join("/")}: ${files.length} file(s), ${passed} passed, ${failed} failed`);
for (const b of broken) console.error(`  !! ${b}`);
process.exit(failed === 0 && broken.length === 0 ? 0 : 1);
