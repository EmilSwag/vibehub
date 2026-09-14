---
SECTION_ID: plans.round8-web-ui
TYPE: plan
STATUS: completed
PRIORITY: high
---

# Round 8 — profile UI (web only)

Scope boundary: everything lands under `vibehub/web/`, with **one** sanctioned exception —
`docs/DESIGN.md`, which the PO asked for explicitly in the third instruction. Nothing else
above `web/` is written: no repo-root plan, and no `package-lock.json` churn (the icon
packages are one-shot codegen inputs installed outside the repo, see Step 1.1).

Design law: `vibehub/docs/DESIGN.md` (strict monochrome, `--vh-*` tokens only, zero hue
except `--vh-live`) plus the design-eng house rules — 120ms press / 200ms state change /
320ms enter, `prefers-reduced-motion` honoured everywhere.
Skills consulted: `emil_design_eng` (`tools: developer / frontend`, the only VibeHub-relevant
template on the MCP server — read in full before Step 1). No template covers SVG brand-mark
extraction, so Step 1.1's codegen script is a custom approach.

## Step 1 — `BrandMark`, the mark system  [skill: emil_design_eng]

### 1.1 Path provenance — generated, never hand-edited  [skill: emil_design_eng]

Mirrors the existing `build-brand.mjs` → `logo-geometry.ts` convention.

- [x] `web/scripts/build-brand-marks.mjs` emits `web/src/components/ui/brand-mark-paths.ts`
      with a provenance banner (package + version + licence). The icon packages are
      installed outside the repo and passed with `--from`, so no dependency and no
      root-lockfile change survives the run.
- [x] **simple-icons (CC0-1.0)** where a slug exists: `claude`, `claudecode`, `cursor`,
      `googlegemini`, `windsurf`, `zedindustries`, `github`, `x`, `telegram`, `youtube`,
      `discord`.
- [x] **`@lobehub/icons-static-svg` (MIT)** for OpenAI, Grok, Codex, and
      **`@iconify-json/logos` (CC0)** for VS Code. *Deviation from the brief, stated
      openly:* it said "faithful hand-drawn marks otherwise", but the OpenAI blossom is a
      six-fold knot on a hexagonal lattice — drawn from memory it would be recognisably
      wrong at 26px, and "faithful" is the bar. Swapping any one back is a single table row.
- [x] Hand-drawn in `brand-mark-hand.ts`, because no open set carries them: **Quadcode AI**
      (a clean Q — r10 ring, 3 thick, capsule tail on the diagonal), **LinkedIn** (the "in";
      simple-icons v16 dropped it, and the shape already shipped in LinkIcon), the
      **website globe**, and the **neutral** placeholder.
- [x] Paths are re-emitted verbatim. A mark whose source grid is not 24 (VS Code, 256×254)
      is fitted by a `<g transform>` rather than by rewriting its numbers.

### 1.2 The component  [skill: emil_design_eng]

- [x] `BrandMark.tsx` — `viewBox="0 0 24 24"`, `fill="currentColor"`, no stroke,
      `aria-hidden`, integer sizes, no insets. `MarkGlyph` is the shared `<svg>` so
      `LinkIcon` paints from the same table.
- [x] `MARK_BY_FAMILY` is a `Record` over the full `ModelFamily | ToolFamily` union, so a
      family added to `format.ts` without a mark is a compile error — the guard the old
      `unglyphed(_family: never)` provided.

### 1.3 Rewire  [skill: emil_design_eng]

- [x] `ModelGlyph` / `ToolGlyph` keep their exact props and render `BrandMark`; all nine
      call sites (`RecentModels`, `TrackingStatus`, `PresenceBlock`, `ConnectCelebration`)
      updated with zero edits.
- [x] The three glyph CSS classes set only `flex` and `color`, so the stroke→fill switch
      needed no CSS change.

### 1.4 Verify  [skill: emil_design_eng]

- [x] `src/lib/__checks__/brandMark.check.ts` — 73 assertions: every family resolves to real
      geometry, only `unknown` may land on the neutral fallback, no path carries colour,
      real ids route to the brand they belong to.
- [x] `scripts/brand-marks-sheet.mjs` → `ui_views/brand-marks.html`: every mark at
      12/16/26/64, both themes, plus the "beside the text they label" rows. Bundles the
      shipping component, so the sheet cannot drift from the app.
- [x] Hue-leak pass on the sheet: every computed `color` / `background` / `fill` has
      `r === g === b`. Zero leaks.

## Step 2 — the Models block becomes a control  [skill: emil_design_eng]

- [x] `lib/recentModels.ts` keeps the per-tool buckets instead of discarding them in the
      merge: `RecentModelRow.byTool` (tool, tokens, hours, lastActiveAt, estimated), hours
      desc; `tools` is now derived from it. Pinned by 5 new assertions in
      `recentModels.check.ts`, including that `byTool` sums back to the row.
- [x] Rows are real `<button>`s. Collapsed: expand to all models, select the row,
      `scrollIntoView({ block: "nearest" })` (smooth, or instant under reduced motion).
      Expanded: toggle that row's per-tool detail line.
- [x] Detail opens with `grid-template-rows: 0fr → 1fr` plus an opacity fade, and a left
      rule rather than an indent (the capsule is 120px on a preview row, 34px on a
      revealed one).
- [x] Tool chips are buttons with `stopPropagation`, toggling a tool filter: matching rows
      full opacity, others 0.45, the active chip inverted (`--vh-accent` / `--vh-on-accent`),
      click again clears, and the filter expands the list.
- [x] Escape peels one layer at a time — filter, detail, highlight, list — and only claims
      the key when it has something to undo. "Show less" clears all four at once.
- [x] Stats "Top model" is a button carrying that model's mark; it jumps to Models, expands
      and selects the row (`ModelFocus` carries a nonce so a second click on the same tile
      lands again).
- [x] Skeleton keeps the same `.item > .row` silhouette and the 120×45 capsule that holds
      the 26px mark, so nothing moves when the rows land.

### Bug found and fixed while verifying

- [x] The row mute did nothing: the list is a `.stagger` parent, so every `<li>` carries
      `vh-fade-up … both`, and a **filled animation beats any declarative `opacity`**. The
      class applied and the computed value stayed `1`. The fade now lands on the row's
      children. Measured 0.45 / 1 in the browser after the fix.

## Step 3 — profile header  [skill: emil_design_eng]

- [x] `LinkIcon` paints real marks for GitHub, X (server key `twitter`), Telegram, YouTube,
      LinkedIn, Discord, and a globe for the website fallback.
- [x] `.linkChip` gains a shared hover **and** `:focus-visible` state (colour + background
      step) and a pressed `scale(0.98)` — an `<a>` gets none from the global button rule.
- [x] Role badges carry their onboarding blurb as a `title`; the archetype badge carries a
      new blurb written from what `jobs/archetype.ts` actually measures.
- [x] Nothing else in the header changed.

## Step 4 — `docs/DESIGN.md`

- [x] "Abstract shapes only, no brand marks" is replaced by a **Brand marks** section:
      *monochrome brand marks, `currentColor`, never coloured, one size per slot* — with
      the per-slot sizes, the generated-geometry rule, and the note that `RoleGlyph` /
      `ArchetypeGlyph` stay abstract because they name a person, not a product.

## Not done — needs a change above `web/`

- **Telegram links never reach the client.** `server/src/lib/links.ts` `ICON_MAP` has no
  `t.me` / `telegram.org` entry, so `detectIcon` returns `generic` and a Telegram link
  renders the globe. The mark is wired and waiting; the server needs two map entries.

## Progress log

- 2026-09-07 — all four steps landed. `npm run build` green (EOL fix → `tsc -b` → `vite
  build` → EOL check). Contract checks: brandMark 73, format 121, recentModels 20, all
  passing. simple-icons v16.30 surveyed: it has Claude, Claude Code, Cursor, Google Gemini,
  Windsurf, Zed, GitHub, X, Telegram, YouTube, Discord — and **no** OpenAI, ChatGPT, Grok,
  Codex, VS Code or LinkedIn.
