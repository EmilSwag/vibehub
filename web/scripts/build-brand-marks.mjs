#!/usr/bin/env node
// Brand-mark path extractor — the single source for src/components/ui/brand-mark-paths.ts.
//
// Round 8 replaced the abstract model/tool glyphs with the real marks. Path data is
// *extracted*, never redrawn: an approximation of the OpenAI blossom or the Claude
// burst is recognisably wrong at 26px, and "faithful" is the bar the PO set. Same rule
// as scripts/build-brand.mjs → logo-geometry.ts: geometry is generated, the derived
// file carries a do-not-edit banner and nobody hand-edits it.
//
// The icon packages are build-time inputs, not dependencies of the app — the emitted
// file is plain strings, so nothing ships in the bundle and web/package.json stays
// untouched. Install them wherever you like and point the script at that node_modules:
//
//   mkdir /tmp/iconref && cd /tmp/iconref && npm init -y
//   npm i simple-icons @lobehub/icons-static-svg @iconify-json/logos
//   node web/scripts/build-brand-marks.mjs --from /tmp/iconref/node_modules
//
// Sources, in the order of preference the PO set:
//   simple-icons (CC0-1.0)                 — wherever a slug exists
//   @lobehub/icons-static-svg (MIT)        — the AI marks simple-icons dropped
//   @iconify-json/logos (CC0-1.0)          — VS Code, which neither of the above carries
// Quadcode AI has no third-party mark and is drawn by hand in BrandMark.tsx.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(webRoot, "src", "components", "ui", "brand-mark-paths.ts");

const fromArg = process.argv.indexOf("--from");
const modules = fromArg === -1 ? join(webRoot, "node_modules") : process.argv[fromArg + 1];

// ---------------------------------------------------------------------------
// What each mark is, and where its geometry comes from.
// `id` is the key BrandMark.tsx looks up; it is a mark, not a ToolFamily — several
// families share one (ChatGPT and the GPT model family are both the OpenAI blossom).
// ---------------------------------------------------------------------------
const MARKS = [
  { id: "claude", from: "simple-icons", slug: "claude" },
  { id: "claude-code", from: "simple-icons", slug: "claudecode" },
  { id: "cursor", from: "simple-icons", slug: "cursor" },
  { id: "gemini", from: "simple-icons", slug: "googlegemini" },
  { id: "windsurf", from: "simple-icons", slug: "windsurf" },
  { id: "zed", from: "simple-icons", slug: "zedindustries" },
  { id: "openai", from: "lobehub", slug: "openai" },
  { id: "grok", from: "lobehub", slug: "grok" },
  { id: "codex", from: "lobehub", slug: "codex" },
  // The `logos` body is a full-colour stack; the silhouette we want is the single
  // <defs> path every layer masks against. `hole: true` because the fold notch is a
  // second subpath that must punch through, which only even-odd guarantees.
  { id: "vscode", from: "logos", slug: "visual-studio-code", hole: true },

  // Profile-header links (LinkIcon). Same rule, different slot: the server hands the
  // client an icon key it detected from the hostname, and the key resolves to one of
  // these. "twitter" resolves to X, which is the mark the product actually uses now.
  { id: "github", from: "simple-icons", slug: "github" },
  { id: "x", from: "simple-icons", slug: "x" },
  { id: "telegram", from: "simple-icons", slug: "telegram" },
  { id: "youtube", from: "simple-icons", slug: "youtube" },
  { id: "discord", from: "simple-icons", slug: "discord" },
  // LinkedIn is not in simple-icons v16 either. Its "in" letterform is simple enough
  // to hold by hand and already shipped in LinkIcon, so it stays hand-drawn — see
  // brand-mark-hand.ts.
];

const SOURCES = {
  "simple-icons": { pkg: "simple-icons", license: "CC0-1.0" },
  lobehub: { pkg: "@lobehub/icons-static-svg", license: "MIT (LobeHub)" },
  logos: { pkg: "@iconify-json/logos", license: "CC0-1.0" },
};

const version = (pkg) => JSON.parse(readFileSync(join(modules, pkg, "package.json"), "utf8")).version;

// --- simple-icons ----------------------------------------------------------
// Exported as siClaude, siGooglegemini, … — first letter up, rest verbatim.
const si = await import(pathToFileURL(join(modules, "simple-icons", "index.mjs")).href);
function fromSimpleIcons(slug) {
  const icon = si[`si${slug.charAt(0).toUpperCase()}${slug.slice(1)}`];
  if (!icon) throw new Error(`simple-icons has no slug "${slug}"`);
  return { d: icon.path, title: icon.title, box: 24 };
}

// --- lobehub ---------------------------------------------------------------
// One <path> per file, already on a 24 grid, `fill-rule="evenodd"` on the <svg>.
function fromLobehub(slug) {
  const file = join(modules, "@lobehub", "icons-static-svg", "icons", `${slug}.svg`);
  const svg = readFileSync(file, "utf8");
  const d = svg.match(/\sd="([^"]+)"/)?.[1];
  const title = svg.match(/<title>([^<]*)<\/title>/)?.[1] ?? slug;
  if (!d) throw new Error(`no path data in ${file}`);
  return { d, title, box: 24, evenOdd: /fill-rule="evenodd"/.test(svg) };
}

// --- iconify logos ---------------------------------------------------------
function fromLogos(slug) {
  const set = JSON.parse(readFileSync(join(modules, "@iconify-json", "logos", "icons.json"), "utf8"));
  const icon = set.icons[slug];
  if (!icon) throw new Error(`@iconify-json/logos has no icon "${slug}"`);
  const d = icon.body.match(/<defs>[\s\S]*?<path[^>]*\sd="([^"]+)"/)?.[1];
  if (!d) throw new Error(`no <defs> silhouette path in logos/${slug}`);
  return {
    d,
    title: slug,
    box: { w: icon.width ?? set.width ?? 24, h: icon.height ?? set.height ?? 24 },
  };
}

const READERS = { "simple-icons": fromSimpleIcons, lobehub: fromLobehub, logos: fromLogos };

// ---------------------------------------------------------------------------
// A mark whose source grid is not 24×24 is scaled by a <g transform>, never by
// rewriting its numbers: re-fitting path data is exactly what costs crispness, and
// the browser applies the transform before rasterising, so nothing is lost at 12px.
// ---------------------------------------------------------------------------
const round = (n) => Number(n.toFixed(5));

function fitTo24(box) {
  if (box === 24) return null;
  const { w, h } = box;
  if (w === 24 && h === 24) return null;
  const scale = round(24 / Math.max(w, h));
  const dx = round((24 - w * scale) / 2);
  const dy = round((24 - h * scale) / 2);
  const move = dx === 0 && dy === 0 ? "" : `translate(${dx} ${dy}) `;
  return `${move}scale(${scale})`;
}

const entries = MARKS.map((mark) => {
  const icon = READERS[mark.from](mark.slug);
  return {
    ...mark,
    d: icon.d,
    title: icon.title,
    transform: fitTo24(icon.box),
    evenOdd: Boolean(mark.hole || icon.evenOdd),
  };
});

// ---------------------------------------------------------------------------
// Emit. LF only — scripts/normalize-eol.mjs guards public/, but a CRLF source file
// would still churn every diff on a Windows checkout.
// ---------------------------------------------------------------------------
const used = [...new Set(entries.map((e) => e.from))];
const credits = used.map((k) => `//   ${SOURCES[k].pkg}@${version(SOURCES[k].pkg)} — ${SOURCES[k].license}`);

const body = entries
  .map((e) => {
    const fields = [`    d: ${JSON.stringify(e.d)},`];
    if (e.transform) fields.push(`    transform: ${JSON.stringify(e.transform)},`);
    if (e.evenOdd) fields.push(`    fillRule: "evenodd",`);
    return `  /** ${e.title} — ${SOURCES[e.from].pkg} \`${e.slug}\` */\n  "${e.id}": {\n${fields.join("\n")}\n  },`;
  })
  .join("\n");

const out = `// Generated by scripts/build-brand-marks.mjs. Do not edit by hand.
// Re-run it after adding a mark; see the script header for the one-off install.
//
// Marks are reproduced verbatim from their sources, monochrome, on a 24 grid:
${credits.join("\n")}
//
// Each is a trademark of its owner and is used here only to identify that product
// next to its own name. Quadcode AI's mark has no third-party source and is drawn
// in BrandMark.tsx alongside the neutral fallback.

export interface BrandMarkPath {
  /** Path data, exactly as published — never re-fitted. */
  readonly d: string;
  /** Set when the source grid is not 24x24: applied to a wrapping <g>. */
  readonly transform?: string;
  /** Set when a subpath has to punch a hole rather than fill solid. */
  readonly fillRule?: "evenodd";
  /** Line art instead of a solid fill, at this stroke width on the 24 grid. Used by
   *  the 12px variants: a 2.2 stroke lands on ~1.1 device px, which stays a line
   *  where a filled shape of the same weight would close up. */
  readonly stroke?: number;
  /** What to draw below 14px, when this mark's interior detail stops resolving.
   *  See brand-mark-small.ts — never generated, always a deliberate redraw. */
  readonly small?: BrandMarkPath;
}

/** Mark ids, not tool/model families — several families share one mark. */
export const BRAND_MARK_PATHS = {
${body}
} as const satisfies Record<string, BrandMarkPath>;

export type BrandMarkId = keyof typeof BRAND_MARK_PATHS;
`;

writeFileSync(OUT, out.replace(/\r\n/g, "\n"), "utf8");
console.log(`brand marks → ${OUT}`);
for (const e of entries) {
  const grid = e.transform ? `transform ${e.transform}` : "24 grid";
  console.log(`  ${e.id.padEnd(12)} ${String(e.d.length).padStart(5)} chars  ${grid}  (${SOURCES[e.from].pkg})`);
}
