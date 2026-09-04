# VibeHub Design Spec — Strict Monochrome

Steam-like layout structure, zero-hue skin — with exactly **one** deliberate exception, live-presence green (below). Single source of truth for colors/type/shape: `web/src/styles/tokens.css`. **Never hardcode colors — use `--vh-*` vars only. No hue is ever introduced by any component (`BUILD_PLAN.md §5`) beyond `--vh-live` — enforce this in review, not just at token-definition time.**

## Mood
Calm, editorial, high-contrast, "ink on paper". Pale gray background, white cards, ink-black accent, serif display headings. Absolutely NO gradients, NO hue of any kind (no warm tints, no cool grays, no neon) — every value is a shade of gray, black, or white. The single exception is `--vh-live`: the green that means "online right now", and nothing else.

## Palette (light = default)
| Role | Value |
|---|---|
| App background | `#F5F5F5` |
| Card / elevated | `#FFFFFF` |
| Sidebar / panel / hover | `#ECECEC` |
| Border | `#DCDCDC` |
| Text primary | `#111111` |
| Text secondary | `#555555` |
| Text faint | `#8A8A8A` |
| **Accent (ink)** | `#111111`, hover `#333333`, soft bg `#E6E6E6`, on-accent `#FFFFFF` |
| **Live presence — the one hue** | `--vh-live` `#16A34A` (dark `#22C55E`), `--vh-live-soft` `rgba(22,163,74,.12)` (dark `rgba(34,197,94,.16)`), `--vh-on-live` `#FFFFFF` |
| Status: active / idle / offline | `--vh-live` / `#8A8A8A` / `#C8C8C8` — active is the green; idle and offline stay lightness-only |

`--vh-live` / `--vh-live-soft` / `--vh-on-live` paint the live/online presence state only: the
green dot, its pulse ring, a "live" pill. Never reuse them for success, links, charts, errors or
any other meaning — errors read as ink (`--vh-danger` = `--vh-text`).

Dark mode: bg `#0F0F0F`, surface `#171717`, text `#F2F2F2`, accent `#F2F2F2` (on-accent `#111111`),
live `#22C55E` — applied both automatically via `prefers-color-scheme: dark` and explicitly via
`[data-theme="dark"]`, kept in lockstep in `tokens.css` (three blocks — `:root`, the media query,
`[data-theme="dark"]` — edit all three together).

**Theme is user-selectable.** `web/src/lib/theme.ts` is the only owner of `<html data-theme>`:
preference `system` (default — no attribute, follows the OS), `light` or `dark` (explicit
attribute, wins over the OS). Persisted in `localStorage["vh-theme"]` (absent = system) and
pre-applied by the inline script in `web/index.html` so the first paint is already right.
`ThemeToggle` is the only writer; components never read the theme — they read tokens.

## Typography
- **Display / h1–h3 / greeting**: serif — Tiempos Text stack (`--vh-font-serif`), weight 500, tight leading. Like Claude's "Back at it" greeting.
- **UI / body / buttons / nav**: grotesque sans — Styrene stack (`--vh-font-sans`).
- **Numbers & code (stats, tokens)**: `--vh-font-mono`.
- Note: Styrene/Tiempos are licensed → stacks fall back to free lookalikes (Inter / Source Serif 4). Do not bundle proprietary font files in the repo.

## Shape & elevation
- Radii: buttons/inputs 12px (`--vh-radius-md`), cards 16px (`--vh-radius-lg`), badges/avatars pill/circle.
- Shadows: `--vh-shadow-card` (subtle) and `--vh-shadow-pop` (popovers). Never harsh.
- Borders 1px `--vh-border` on every card; hairline dividers.

## Components
- **Primary button**: accent bg, on-accent text, radius-md, medium weight; hover → `--vh-accent-hover`. No shadow.
- **Secondary button**: surface bg, 1px border, primary text; hover bg `--vh-surface-2`.
- **Ghost/icon button**: transparent, hover `--vh-surface-2`.
- **Card**: surface, border, radius-lg, shadow-card, padding 24.
- **Inputs**: surface, border, radius-md; focus = 2px `--vh-focus-ring` ring, accent border.
- **Badges (archetype, model tags)**: pill, `--vh-surface-2` bg or `--vh-accent-soft` for active; small sans caps.
- **Status dot**: 8px circle + label ("in neon-app · Claude Code · 1h 42m"); active = `--vh-live` green (the one hue; optional pulse ring in `--vh-live-soft`), idle/offline conveyed by lightness only (`--vh-status-*`).
- **Avatar**: circle, 1px border; fallback = `--vh-surface-2` bg + serif initial.
- **Stat tiles**: surface card, big mono number, small dim label; accent used for highlight number only.
- **Wall comment**: `--vh-surface-2` bubble, radius-lg, author avatar left.
- **Charts (tokens per model, time per tool)**: bar charts in `--vh-accent` + neutral grays only, flat fills — never per-series hue coding.

## Layout
- Top bar: white, hairline bottom border, logo mark left, nav sans, avatar right.
- Content max-width ~1100px on `#FAF9F5`; sidebar panels ivory.
- Profile hero: big serif display name + archetype badge + status line, avatar 96px.
- Generous whitespace (24/40 spacing steps), calm density.

## Logo usage

The mark is a **presence ring**: three uneven session arcs, a solid centre node (you), and a
bead riding the ring (your live status). It is single-colour and painted with `currentColor`,
so it resolves to `--vh-accent` and introduces no hue in either theme.

- **Geometry is generated.** `scripts/build-brand.mjs` is the single source. It emits the
  standalone SVGs, the Lottie loop, and `web/src/components/ui/logo-geometry.ts` that the
  in-app `<Logo>` imports. Never hand-edit the derived files; change the script and rerun
  `node scripts/build-brand.mjs`.
- **Legibility floor is 16px.** Below that the 24-degree gaps close up and the ring reads solid.
  Favicon 16, onboarding brand row 16, top bar 20, sign-in 56.
- **Motion.** One 2.4s loop: the bead makes exactly one revolution while the node beats twice
  and a pulse leaves it and dissolves past the ring. Frame 144 renders identically to frame 0,
  so it loops with no seam. `Logo.module.css` reproduces it in CSS for in-app use;
  `assets/branding/vibehub-mark-loop-*.json` is the portable Lottie.
- **Where it animates.** Sign-in runs the Lottie (a brand moment, once per session). The top bar
  runs the CSS loop only while the home link is hovered or focused. Everywhere else the mark is
  still: perpetual motion in chrome is decoration, not communication.
- Never stretch, never recolour outside the `--vh-*` palette, never add a second hue.

### Brand files
| File | Use |
|---|---|
| `assets/branding/vibehub-mark.svg` | favicon: follows `prefers-color-scheme` |
| `assets/branding/vibehub-mark-{ink,paper}.svg` | explicit colourway, for embedding |
| `assets/branding/vibehub-lockup-{ink,paper}.svg` | mark + serif wordmark |
| `assets/branding/vibehub-mark-loop-ink.json` | Lottie, `#111111`, for light grounds |
| `assets/branding/vibehub-mark-loop-paper.json` | Lottie, `#F2F2F2`, for dark grounds |
| `assets/branding/vibehub-mark-1024*.png` | raster mark, transparent, both colourways |
| `assets/branding/banner.png` | README banner, 1280x400 |
| `web/public/brand/` | the copies the SPA serves |

`logo.png`, `icon.png` and `banner_source.png` are the earlier colourway and are superseded.

**Pick the colourway explicitly when embedding.** An `<img>` resolves
`prefers-color-scheme` against the OS, not the page it sits on, so the auto file disappears on a
light page under a dark OS. Only the favicon should be auto.

The SPA ships one Lottie colourway and overrides its baked fill with `currentColor` in
`LogoLottie.module.css`, so a single file follows the theme. The two baked colourways exist for
players that cannot be themed.

## Product rules
- **Tokens are fuel, not rank.** Token counts are a personal gauge ("burning tokens in neon-app"), never a score. Never rank, sort, badge or order people by tokens — no leaderboards, no "top burner", no friends list sorted by usage. Compare views put two people side by side on equal footing and never declare a winner.
- Presence is the only live signal and the only hue. Everything else is quiet chrome.

## Voice
Short, warm, lowercase-friendly microcopy ("friends for 214 days", "burning tokens in neon-app").
