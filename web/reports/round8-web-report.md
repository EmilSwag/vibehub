# Round 8 — profile UI (web)

**Date:** 2026-09-07 · **Branch:** `main` · **Scope:** `vibehub/web/`, plus `docs/DESIGN.md`
by explicit request. `server/` deliberately untouched.

**Build:** `npm run build` green — EOL fix → `tsc -b` → `vite build` → EOL check.
**Contract checks:** `brandMark` 117 passed, `format` 121 passed, `recentModels` 20 passed.

**Plan:** `web/meta/plans/round8-web-ui.md` — kept inside `web/` rather than the usual
`Vibemunity/meta/plans/`, per the "never above it" boundary.

**Proof sheet:** `web/ui_views/brand-marks.html` — every mark at 12/16/26/64 in both
themes, plus a **12px magnifier** (rasterised at exactly 12 CSS px, blown up 8×
nearest-neighbour, with ink coverage). Generated from the shipping component, so it
cannot drift from the app.
Regenerate with `node scripts/brand-marks-sheet.mjs`; serve it with any static server
(the session's one on :4788 has been stopped).

---

## 1. Files changed

### New

| File | What it is |
|---|---|
| `scripts/build-brand-marks.mjs` | Extracts brand-mark path data into the generated table. One-shot codegen; the icon packages are passed in with `--from` and never enter the repo. |
| `scripts/brand-marks-sheet.mjs` | Bundles the real `BrandMark.tsx` and `LinkIcon.tsx` and renders `ui_views/brand-marks.html`. |
| `src/components/ui/BrandMark.tsx` | The mark component, the family→mark table, `MarkGlyph` (the shared `<svg>`), `brandMarkFor`. |
| `src/components/ui/brand-mark-paths.ts` | **Generated.** Path data + provenance banner. Do not hand-edit. |
| `src/components/ui/brand-mark-hand.ts` | The four marks with no third-party source. |
| `src/components/ui/brand-mark-small.ts` | The four 12px redraws. Hand-authored, never generated. |
| `src/lib/__checks__/brandMark.check.ts` | 73 contract assertions for the mark system. |
| `meta/plans/round8-web-ui.md` | The plan, worked and marked off. |
| `ui_views/brand-marks.html` | **Generated.** The proof sheet. |
| `reports/round8-web-report.md` | This file. |

### Modified

| File | Change |
|---|---|
| `src/components/ui/ModelGlyph.tsx` | Now a thin wrapper over `BrandMark`; props unchanged. |
| `src/components/ui/ToolGlyph.tsx` | Same. `ToolGlyphPath` and `unglyphed(_family: never)` are gone — the exhaustiveness guard moved to `MARK_BY_FAMILY`, which is stricter. |
| `src/components/LinkIcon.tsx` | Real marks from the same generated table; exports `LINK_MARKS` for the proof sheet. |
| `src/components/RecentModels.tsx` | Rows are buttons; per-tool detail line; tool-chip filter; Escape peeling; `focus` prop for the Top-model jump. |
| `src/components/RecentModels.module.css` | `.item` / `.row` / `.detail` split, the stretched `.rowHit` button, chip states, detail styling, narrow-screen rules. |
| `src/lib/recentModels.ts` | `RecentModelToolBucket` + `RecentModelRow.byTool`; `tools` derived from it. |
| `src/lib/motion.ts` | New `prefersReducedMotion()` — motion CSS cannot reach `scrollIntoView`'s `behavior`. |
| `src/components/StatsPanel.tsx` | "Top model" tile carries the model's mark and an `onTopModel` callback. |
| `src/components/ui/StatTile.tsx` + `.module.css` | Optional `mark`, `onClick`, `actionLabel`; a clickable tile keeps the exact same box. |
| `src/components/ui/RoleGlyph.tsx` | Exports `roleBlurb()`. |
| `src/components/ui/ArchetypeGlyph.tsx` | Adds `BLURBS` + `archetypeBlurb()`. |
| `src/pages/ProfilePage.tsx` | Wires Stats → Models (`ModelFocus` with a nonce); badge tooltips. |
| `src/pages/ProfilePage.module.css` | `.linkChip` hover + `:focus-visible` + pressed states. |
| `src/lib/__checks__/recentModels.check.ts` | 5 new assertions pinning `byTool`. |
| `docs/DESIGN.md` | New **Brand marks** section (see §4). |

---

## 2. Where each mark came from

### simple-icons (CC0-1.0) — 11 marks

`claude`, `claudecode`, `cursor`, `googlegemini`, `windsurf`, `zedindustries`,
`github`, `x`, `telegram`, `youtube`, `discord`.

### Hand-drawn — 4 marks (`brand-mark-hand.ts`)

| Mark | Why, and how |
|---|---|
| **Quadcode AI** | No third-party mark exists. A clean **Q**: r10 ring 3 units thick, plus a 3-wide capsule tail crossing it on the diagonal, from inside the counter to just past the outer edge. |
| **LinkedIn** | simple-icons v16 dropped it. The "in" letterform is regular enough to hold by hand, and this exact path already shipped in `LinkIcon`. |
| **Website globe** | There is no brand to be faithful to. The fallback for any host the server does not recognise. |
| **Neutral** | Deliberately *not* a brand — dot-in-circle, so an unrecognised id reads as a placeholder instead of borrowing someone else's mark. |

### Deviation from the brief, stated plainly — 4 marks

The brief said "simple-icons where a slug exists, faithful hand-drawn marks otherwise".
simple-icons v16.30 carries **no** OpenAI, ChatGPT, Grok, Codex, VS Code or LinkedIn.
LinkedIn I drew. For the other four I used a second and third open source instead:

- **`@lobehub/icons-static-svg` (MIT)** — OpenAI, Grok, Codex
- **`@iconify-json/logos` (CC0-1.0)** — VS Code

**Why:** the OpenAI blossom is a six-fold knot on a hexagonal lattice. Reconstructed from
memory it would be recognisably wrong at 26px, and *faithful* was the bar set. Attribution
rides in the generated file's banner. Reverting any one mark to hand-drawn is a single row
in the `MARKS` table in `build-brand-marks.mjs`.

### 12px redraws

A mark at 12px is a 12×12 bitmap, and reading it at 12px on a retina screen tells you
nothing. The proof sheet now rasterises every mark at **exactly 12 CSS px** and blows the
bitmap up 8× nearest-neighbour, with an `ink` figure (share of the 12×12 box filled).
Measured that way, four marks lost the feature that made them themselves:

| Mark | Ink before → after | What was lost, and what replaced it |
|---|---|---|
| Claude Code | 42% → 40% | Legs and eye slots closed into a slab. Now **Claude's own burst** — same product family, and a radial shape holds its form all the way down. |
| Codex CLI | 68% → 12% | A dark blob with the chevron barely visible. Now a **plain terminal chevron and prompt line** — what a CLI looks like at 12px, and what the mark's interior was trying to say. |
| Zed | 45% → 15% | The Z spiralling inside a square became a grey tangle. Now just the **Z**. |
| Website globe | 39% → 25% | Meridians two pixels apart are a grey wash, not lines. Now **circle + equator only** — still a sphere, still distinct from the neutral ring-and-dot. |

Mechanics: `brand-mark-small.ts` (hand-authored, never generated), `SMALL_BELOW = 14` so
the tool chip (12) and the tracker row (13) simplify while 16/18/26 always get the
published mark. The redraws are **line art**, not fills — a 2–3 unit stroke on the 24 grid
lands on ~1–1.5 device px and stays open, where a filled shape of the same weight closes
up. `MarkGlyph` paints `fill="none" stroke="currentColor"` when a variant declares
`stroke`. Pinned by 44 new assertions.

Everything else was checked at true 12px and left exactly as published — Telegram (66%
ink), YouTube (62%), VS Code (53%), Discord (53%), Cursor (47%), GitHub (42%) are all
heavy but keep their distinguishing detail, and a mark that reads is never redrawn.

**One judgement call, flagged:** the OpenAI blossom (36% ink, used by the GPT family and
ChatGPT) is soft at 12px — a grey knot rather than a crisp shape. I left it, because its
*only* distinguishing feature is the interior knot: strip that and you get a circle, which
already means "unknown" in this set, or a hexagon, which reads as generic. A soft-but-right
mark beat a legible-but-wrong one. Say the word and I'll swap it.

### Notes on the mark system

- Paths are re-emitted **verbatim** — never re-fitted, which is what would cost crispness.
  The one mark whose source grid is not 24 (VS Code, 256×254) is fitted with a
  `<g transform>` the browser applies before rasterising.
- Deliberate sharing, pinned by the contract check: the GPT model family and ChatGPT both
  use the OpenAI blossom, because that is what those products actually use. Codex keeps
  its own mark.
- `MARK_BY_FAMILY` is a `Record` over the whole `ModelFamily | ToolFamily` union, so a
  family added to `format.ts` without a mark is a **compile error** — stricter than the
  `unglyphed(_family: never)` guard it replaced.

---

## 3. Browser interactions to verify

Profile page, self and visitor, at 1440 and 390, in light and dark.

### Models block

1. **Collapsed → click any row.** List expands to all N models, that row stays selected
   (`--vh-accent-soft` well, no colour flash), and it scrolls into view with
   `block: "nearest"` — a row already on screen must **not** jump to the middle.
2. **Expanded → click a row.** Its per-tool detail line opens underneath: tool mark +
   label, hours, tokens, last used, one line per tool, most hours first. Click again folds
   it. The lines' hours and tokens sum to the row's own totals.
3. **Tool chip.** Click "Codex CLI" in any row: every row that ran Codex stays at full
   opacity, the rest drop to 0.45, and every Codex chip inverts (ink/paper swap). Click it
   again to clear. Confirm the **row underneath does not fire** — the detail should not
   open.
4. **Escape**, one layer per press: filter → open detail → highlight → collapse. It only
   claims the key when it has something to undo, so anything above still sees its own
   Escape. **"Show less"** clears all four at once.
5. **Stats "Top model".** The tile shows that model's mark and is a button; clicking jumps
   to Models, expands, and selects the row. Click it **twice** — the second click must
   still land (that is what the `nonce` is for).
6. **Skeleton.** Throttle the network and reload: the loading list keeps the same
   `.item > .row` silhouette and the 120×45 capsule, so nothing moves when rows land.

### Profile header

7. **Link chips.** Hover *and* tab through them — both give the same colour + background
   step, and pressing gives `scale(0.98)` (an `<a>` gets no pressed feedback from the
   global button rule). Marks: GitHub, X, Telegram, YouTube, LinkedIn, Discord, globe.
8. **Badges.** Hover a role badge for its onboarding blurb; hover the archetype badge for
   a blurb written from what `jobs/archetype.ts` actually measures. Nothing else in the
   header changed.

### Cross-cutting

9. **Narrow (≤620px).** Detail lines stack the tool name above its three numbers; the
   numbers stop reserving column widths.
10. **Reduced motion.** With `prefers-reduced-motion: reduce`, the detail simply appears,
    nothing slides, and `scrollIntoView` is instant rather than smooth.
11. **Hue leak.** `filter: grayscale(1)` over the page must change nothing visible. Checked
    programmatically on the proof sheet: every computed `color` / `background` / `fill` has
    `r === g === b`, zero leaks.
12. **Marks elsewhere.** The rewired glyphs also reach Home's tracking strip, Live Now,
    Friends, Settings devices and the onboarding connect picker — the props did not change,
    so these need a look rather than a test.

---

## 4. `docs/DESIGN.md`

The old "abstract shapes only, no brand marks" rule is replaced by a **Brand marks**
section stating: *monochrome brand marks, `currentColor`, never coloured, one size per
slot* — with the per-slot sizes (12 tool chip, 13 tracker row, 16 list/link chip, 18 stat
tile, 26 Models capsule), the generated-geometry rule and where the paths live, the
"never shown alone / `aria-hidden`" rule, and the note that `RoleGlyph` and
`ArchetypeGlyph` stay abstract on purpose because they name a *person*, not a product.

---

## 5. A bug found while verifying

**The row mute silently did nothing.** The Models list is a `.stagger` parent, so every
`<li>` carries `vh-fade-up … both` — and a **filled animation beats any declarative
`opacity` in the cascade**. The `.itemMuted` class applied correctly and the computed
value stayed `1`. Caught by reading `getComputedStyle` rather than trusting the screenshot.

Fixed by moving the fade onto the row's children (`.itemMuted > .row`, `.itemMuted >
.detail`), which are not animated. Re-measured in the browser afterwards: 0.45 on filtered
rows, 1 on matches. The reasoning is written into the CSS so it does not get "simplified"
back onto the `<li>`.

---

## 6. Deliberately skipped

- **`server/` — untouched, by instruction.** One consequence worth carrying upstream:
  Telegram links still render the website globe, because `ICON_MAP` in
  `server/src/lib/links.ts` has no `t.me` / `telegram.org` entry, so `detectIcon` returns
  `generic` and the `telegram` key never reaches the client. The mark is wired and waiting
  — the fix is two map entries, server-side.
- **No git commit, no push, no Railway deploy.**
- **No live QA against a real logged-in profile.** Another agent holds :4000 and `dev.db`,
  so the interaction pass ran against a throwaway harness (the real components, a stubbed
  `fetch`) on an isolated port, which was deleted afterwards. Everything in §3 was driven
  and screenshotted there; nothing was verified against production data.
- **No changes to `RoleGlyph` / `ArchetypeGlyph` artwork.** They stay abstract line art on
  purpose; only `ArchetypeGlyph` gained a blurb table for the tooltip.
- **No new dependencies.** The icon packages were installed outside the repo and passed to
  the generator with `--from`, so `web/package.json` and the root `package-lock.json` are
  both unchanged.
