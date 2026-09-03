# VibeHub Design Spec — Strict Monochrome

Steam-like layout structure, zero-hue skin. Single source of truth for colors/type/shape: `web/src/styles/tokens.css`. **Never hardcode colors — use `--vh-*` vars only. No hue is ever introduced by any component (`BUILD_PLAN.md §5`) — enforce this in review, not just at token-definition time.**

## Mood
Calm, editorial, high-contrast, "ink on paper". Pale gray background, white cards, ink-black accent, serif display headings. Absolutely NO gradients, NO hue of any kind (no warm tints, no cool grays, no neon) — every value is a shade of gray, black, or white.

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
| Status: active / idle / offline | `#111111` / `#8A8A8A` / `#C8C8C8` |

Dark mode: bg `#0F0F0F`, surface `#171717`, text `#F2F2F2`, accent `#F2F2F2` (on-accent `#111111`) —
applied both automatically via `prefers-color-scheme: dark` and explicitly via `[data-theme="dark"]`,
kept in lockstep in `tokens.css`.

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
- **Status dot**: 8px circle + label ("in neon-app · Claude Code · 1h 42m"); status conveyed by lightness only (`--vh-status-*`), never hue.
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
The in-app mark (`TopBar`/`LoginPage`) is CSS-only and driven entirely by `--vh-accent`, so it
inherits the monochrome palette automatically in both themes. The standalone brand asset in
`assets/branding/` keeps its own original colorway and is not used inside the SPA — never pull
it into a component in place of the token-driven mark. Never stretch, never recolor outside the
`--vh-*` palette in-app.

## Voice
Short, warm, lowercase-friendly microcopy ("friends for 214 days", "burning tokens in neon-app").
