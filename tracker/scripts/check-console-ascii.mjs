#!/usr/bin/env node
// Guard: every string the tracker prints must be pure ASCII.
//
// Why: the tracker's output is read in Windows consoles, and a Windows console
// decodes a Node process's stdout through the active OEM codepage, not UTF-8. On
// the PO's machine (cp866) an em dash or an arrow arrives as mojibake, so lines
// like
//   Connected: no - token rejected by the server.
// were the one place a user could learn why the site said Offline, and they were
// rendered as garbage exactly there. The same reasoning already governs
// install.ps1 (web/scripts/normalize-eol.mjs enforces ASCII there, round 10, W1);
// this is the tracker half of it.
//
// Scope: string and template literals passed to console.log/error/warn/debug/info
// in tracker/src/**. Comments, identifiers and non-console code are NOT checked —
// prose about `Экраны` or `≈` in a comment never reaches a console.
//
//   node scripts/check-console-ascii.mjs

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const trackerRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(trackerRoot, "src");
const CONSOLE_CALL = /console\s*\.\s*(log|error|warn|debug|info)\s*\(/g;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/**
 * Returns the literal spans inside the argument list that starts at `open` (the
 * index of the "(" ). Walks the source tracking quote state and paren depth, so a
 * call spanning several lines, or one holding nested calls and parenthesised
 * expressions, is bounded correctly rather than by a line-based guess.
 */
function literalsInCall(src, open) {
  const literals = [];
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return { literals, end: i };
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const start = i;
      i += 1;
      let text = "";
      while (i < src.length) {
        if (src[i] === "\\") {
          text += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i += 1;
          break;
        }
        // `${...}` holds expressions, not literal output: skip to the matching
        // brace so an identifier inside an interpolation is not read as text.
        if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
          let braces = 0;
          i += 1;
          while (i < src.length) {
            if (src[i] === "{") braces += 1;
            else if (src[i] === "}") {
              braces -= 1;
              if (braces === 0) {
                i += 1;
                break;
              }
            }
            i += 1;
          }
          continue;
        }
        text += src[i];
        i += 1;
      }
      literals.push({ start, text });
      continue;
    }
    i += 1;
  }
  return { literals, end: src.length };
}

const files = walk(SRC).filter((f) => f.endsWith(".ts"));
const failures = [];
let checked = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const name = relative(trackerRoot, file).split("\\").join("/");
  for (const match of src.matchAll(CONSOLE_CALL)) {
    const open = match.index + match[0].length - 1;
    const { literals } = literalsInCall(src, open);
    for (const lit of literals) {
      checked += 1;
      for (const ch of lit.text) {
        const code = ch.codePointAt(0);
        if (code <= 0x7f) continue;
        const line = src.slice(0, lit.start).split("\n").length;
        failures.push(
          `${name}:${line} console.${match[1]} prints U+${code.toString(16).toUpperCase().padStart(4, "0")} ` +
            `(${JSON.stringify(ch)}) in ${JSON.stringify(lit.text.trim().slice(0, 70))}`,
        );
        break;
      }
    }
  }
}

if (failures.length > 0) {
  console.error("[ascii] FAILED - the tracker must print ASCII only (Windows consoles decode via the OEM codepage):");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("[ascii] use '-' for dashes and '->' for arrows.");
  process.exit(1);
}
console.log(`[ascii] ok - ${checked} console literal(s) in ${files.length} source file(s) are pure ASCII`);
