#!/usr/bin/env node
// Proof sheet for the round-8 brand marks → ui_views/brand-marks.html
//
//   node scripts/brand-marks-sheet.mjs
//
// The sheet is not a mock-up: it bundles src/components/ui/BrandMark.tsx and asks the
// real `brandMarkFor` for every family, so what you look at is exactly what the app
// renders. JSX is compiled to a factory that is never called (the component is read,
// never invoked), which keeps React out of the bundle entirely.
//
// What it is for: the two things a type-checker cannot answer — does each mark still
// read as its brand at 12px, and does a solid mark sit at the same optical weight as
// the 1.75px line-art in Icon.tsx when the two share a row of text.

import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(webRoot, "ui_views");
const OUT = join(OUT_DIR, "brand-marks.html");

async function load(...entry) {
  const bundled = await build({
    entryPoints: [join(webRoot, ...entry)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    jsx: "transform",
    jsxFactory: "__unusedJsx",
    jsxFragment: "__unusedFragment",
    logLevel: "silent",
  });
  const source = bundled.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const { MARK_BY_FAMILY, brandMarkFor, markAt, SMALL_BELOW } = await load(
  "src",
  "components",
  "ui",
  "BrandMark.tsx",
);
const { LINK_MARKS } = await load("src", "components", "LinkIcon.tsx");

// Display names only — the sheet is a QA artifact, so it says the brand out loud
// rather than going through toolLabel()/humanizeModel(), which take raw ids.
const family = (key, name) => ({ key, name, markId: MARK_BY_FAMILY[key], mark: brandMarkFor(key) });
const link = (key, name) => ({ key, name, markId: key, mark: LINK_MARKS[key] });

const MODELS = [
  family("claude", "Claude"),
  family("gpt", "OpenAI — the GPT family"),
  family("gemini", "Google Gemini"),
  family("grok", "Grok"),
  family("unknown", "Unknown model"),
];
const TOOLS = [
  family("claude-code", "Claude Code"),
  family("codex", "Codex CLI"),
  family("cursor", "Cursor"),
  family("vscode", "VS Code"),
  family("windsurf", "Windsurf"),
  family("zed", "Zed"),
  family("quadcode", "Quadcode AI"),
  family("chatgpt", "ChatGPT"),
  family("grok", "Grok"),
  family("unknown", "Unknown tool"),
];
// The profile header's link chips. The key is what the server detected from the
// hostname, which is why X still arrives as "twitter".
const LINKS = [
  link("github", "GitHub"),
  link("twitter", "X (server key: twitter)"),
  link("telegram", "Telegram"),
  link("youtube", "YouTube"),
  link("linkedin", "LinkedIn"),
  link("discord", "Discord"),
  link("generic", "A website (the fallback)"),
];

const SIZES = [12, 16, 26, 64];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** For a double-quoted attribute — the mark JSON is full of quotes. */
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

// Goes through `markAt`, so the 12px column shows the 12px redraw and 16/26/64 show the
// published mark — exactly what the app paints at each of those sizes.
function svg(mark, size) {
  const drawn = markAt(mark, size);
  const stroked = drawn.stroke !== undefined;
  const rule = drawn.fillRule ? ` fill-rule="${drawn.fillRule}"` : "";
  const path = `<path d="${esc(drawn.d)}"${rule}/>`;
  const inner = drawn.transform ? `<g transform="${drawn.transform}">${path}</g>` : path;
  const paint = stroked
    ? `fill="none" stroke="currentColor" stroke-width="${drawn.stroke}" stroke-linecap="round" stroke-linejoin="round"`
    : `fill="currentColor"`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${paint} aria-hidden="true" focusable="false">${inner}</svg>`;
}

// What a mark is at 12px is a 12x12 bitmap, and reading it at 12px on a retina display
// tells you nothing — the panel below rasterises each mark at exactly 12 CSS px and
// blows the *bitmap* up 8x, nearest-neighbour, so you see the pixels the eye gets.
// `ink` is the share of that 12x12 box the mark fills; past roughly 40% a mark stops
// being a shape and becomes a blob, which is what interior detail turns into.
function row({ key, name, markId, mark }) {
  const cells = SIZES.map((s) => `<td class="mark"><span class="box">${svg(mark, s)}</span></td>`).join("");
  return `<tr data-mark="${escAttr(JSON.stringify(markAt(mark, 12)))}" data-redrawn="${mark.small ? "yes" : "no"}">
      <th scope="row"><span class="name">${esc(name)}</span><code>${esc(key)} → ${esc(markId)}${mark.small ? " · 12px redraw" : ""}</code></th>
      ${cells}
      <td class="mark zoom"><canvas width="12" height="12"></canvas><span class="ink"></span></td>
    </tr>`;
}

// The real question for 12px: does the mark hold up beside the text it labels?
function chips(list, size) {
  return list.map(({ name, mark }) => `<span class="chip">${svg(mark, size)}${esc(name)}</span>`).join("");
}

const table = (caption, list) => `<table>
    <caption>${esc(caption)}</caption>
    <thead><tr><th scope="col">family → mark</th>${SIZES.map((s) => `<th scope="col">${s}px</th>`).join("")}<th scope="col">12px, magnified</th></tr></thead>
    <tbody>${list.map(row).join("")}</tbody>
  </table>`;

const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VibeHub brand marks — proof sheet</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f5f5f5; --surface: #fff; --surface-2: #ececec;
    --border: #dcdcdc; --text: #111; --dim: #555; --faint: #8a8a8a;
  }
  :root[data-theme="dark"] {
    --bg: #0f0f0f; --surface: #171717; --surface-2: #202020;
    --border: #2b2b2b; --text: #f2f2f2; --dim: #b4b4b4; --faint: #8a8a8a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 24px 72px;
    background: var(--bg); color: var(--text);
    font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { font-family: ui-serif, Georgia, "Times New Roman", serif; font-weight: 500; font-size: 28px; margin: 0 0 8px; }
  p.lede { color: var(--dim); margin: 0 0 32px; max-width: 62ch; }
  p.lede code { color: var(--text); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
  table {
    width: 100%; border-collapse: collapse; background: var(--surface);
    border: 1px solid var(--border); border-radius: 16px;
    margin: 0 0 32px; overflow: hidden;
  }
  caption {
    caption-side: top; text-align: left; padding: 16px 20px 12px;
    font-weight: 500; letter-spacing: .01em;
  }
  th, td { border-top: 1px solid var(--border); padding: 14px 20px; text-align: left; }
  thead th { font-size: 12px; font-weight: 500; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; }
  tbody th { font-weight: 400; white-space: nowrap; }
  .name { display: block; }
  tbody th code { color: var(--faint); }
  td.mark { width: 96px; }
  .box { display: inline-flex; align-items: center; justify-content: center; min-width: 64px; min-height: 64px; color: var(--dim); }
  td.zoom { width: 132px; text-align: center; }
  td.zoom canvas {
    width: 96px; height: 96px;
    image-rendering: pixelated;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .ink { display: block; margin-top: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--faint); }
  .ink.heavy { color: var(--text); font-weight: 600; }
  .pairs { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 20px; margin: 0 0 32px; }
  .pairs h2 { font-size: 14px; font-weight: 500; margin: 0 0 4px; }
  .pairs p { color: var(--faint); margin: 0 0 16px; font-size: 13px; }
  .line { display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: center; margin: 0 0 14px; }
  .line:last-child { margin: 0; }
  .chip { display: inline-flex; align-items: center; gap: 6px; color: var(--dim); white-space: nowrap; }
  .s12 { font-size: 12px; } .s14 { font-size: 14px; } .s16 { font-size: 16px; }
  .controls { display: flex; gap: 8px; margin: 0 0 24px; }
  button {
    font: inherit; padding: 7px 14px; border-radius: 12px; cursor: pointer;
    border: 1px solid var(--border); background: var(--surface); color: var(--text);
    transition: opacity 120ms cubic-bezier(.22,1,.36,1), transform 120ms cubic-bezier(.22,1,.36,1);
  }
  button:hover { background: var(--surface-2); }
  button:active { transform: scale(.98); }
  button[aria-pressed="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }
  body.grayscale main { filter: grayscale(1); }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
<main>
  <h1>Brand marks</h1>
  <p class="lede">
    Generated from the shipping component — <code>brandMarkFor()</code> in
    <code>src/components/ui/BrandMark.tsx</code>. Every mark is a solid
    <code>currentColor</code> on a 24 grid, so it inherits the row's colour and
    introduces no hue. <strong>Grayscale</strong> is the hue-leak test: nothing on this
    page may change when it is on.
  </p>
  <p class="lede">
    The last column rasterises each mark at <strong>exactly 12 CSS px</strong> and blows
    the bitmap up 8&times;, nearest-neighbour — that is what the eye actually gets in a
    tool chip, which reading the 12px column on a retina screen will not tell you.
    <code>ink</code> is the share of the 12&times;12 box the mark fills. A row marked
    <code>12px redraw</code> paints simplified line art below ${SMALL_BELOW}px because its
    interior detail stopped resolving; 16px and up are always the published mark.
  </p>

  <div class="controls">
    <button type="button" id="theme" aria-pressed="false">Dark</button>
    <button type="button" id="gray" aria-pressed="false">Grayscale</button>
  </div>

  ${table("Model families", MODELS)}
  ${table("Tool families", TOOLS)}
  ${table("Profile-header links", LINKS)}

  <section class="pairs">
    <h2>Beside the text they label</h2>
    <p>A mark is never shown alone. This is the size it is actually used at: 12px in a tool chip, 14px in a tracker row, 16px in a list or a link chip.</p>
    <div class="line s12">${chips(TOOLS, 12)}</div>
    <div class="line s14">${chips(MODELS, 14)}</div>
    <div class="line s16">${chips(LINKS, 16)}</div>
  </section>
</main>
<script>
  // Rasterise every mark at exactly 12x12 and show the bitmap 8x, nearest-neighbour.
  // Ink coverage comes from the alpha channel, so it measures the shape, not the colour.
  const results = [];
  for (const tr of document.querySelectorAll("tbody tr[data-mark]")) {
    const mark = JSON.parse(tr.dataset.mark);
    const canvas = tr.querySelector("canvas");
    const label = tr.querySelector(".ink");
    const name = tr.querySelector(".name").textContent;
    const rule = mark.fillRule ? ' fill-rule="' + mark.fillRule + '"' : "";
    const path = '<path d="' + mark.d.replace(/&/g, "&amp;").replace(/</g, "&lt;") + '"' + rule + "/>";
    const inner = mark.transform ? '<g transform="' + mark.transform + '">' + path + "</g>" : path;
    const paint =
      mark.stroke !== undefined
        ? 'fill="none" stroke="#000" stroke-width="' + mark.stroke + '" stroke-linecap="round" stroke-linejoin="round"'
        : 'fill="#000"';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" ' + paint + ">" + inner + "</svg>";
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, 12, 12);
      ctx.drawImage(img, 0, 0, 12, 12);
      const { data } = ctx.getImageData(0, 0, 12, 12);
      let alpha = 0;
      for (let i = 3; i < data.length; i += 4) alpha += data[i];
      const ink = alpha / (12 * 12 * 255);
      label.textContent = "ink " + (ink * 100).toFixed(0) + "%";
      label.classList.toggle("heavy", ink > 0.4);
      results.push({ name, ink: +(ink * 100).toFixed(1) });
      results.sort((a, b) => b.ink - a.ink);
      window.__inkReport = results;
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  const root = document.documentElement;
  const theme = document.getElementById("theme");
  const gray = document.getElementById("gray");
  theme.addEventListener("click", () => {
    const on = root.getAttribute("data-theme") !== "dark";
    root.setAttribute("data-theme", on ? "dark" : "light");
    theme.setAttribute("aria-pressed", String(on));
    theme.textContent = on ? "Light" : "Dark";
  });
  gray.addEventListener("click", () => {
    const on = !document.body.classList.contains("grayscale");
    document.body.classList.toggle("grayscale", on);
    gray.setAttribute("aria-pressed", String(on));
  });
</script>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html.replace(/\r\n/g, "\n"), "utf8");
console.log(`proof sheet → ${OUT}`);
console.log(
  `  ${MODELS.length} model families, ${TOOLS.length} tool families, ${LINKS.length} link icons, sizes ${SIZES.join("/")}`,
);
