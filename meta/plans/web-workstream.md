---
SECTION_ID: plans.web_workstream_implementation
TYPE: plan
STATUS: completed
PRIORITY: high
---

# Web Workstream — Full SPA Implementation

GOAL: Implement Workstream 2 (`web/`) per `docs/BUILD_PLAN.md` §5 and the frozen
contracts in `docs/ARCHITECTURE.md` §2/§5, with UI 1:1 to `docs/DESIGN.md` (Claude
brandbook) using only `--vh-*` tokens from `web/src/styles/tokens.css`. Scope is
strictly `web/`; `docs/` and `assets/` are read-only; `server/`, `tracker/`, `macos/`
are untouched.
ASSIGNEE: web-workstream builder agent

## Skill/template check (required by project CLAUDE.md before any solution)

Ran `ToolGetTemplates` (broad, then `type=developer/frontend`) — no such type exists.
Full catalog returned only: `skills: gamedev`, `skills: product`, `skills: quadcode.ai`,
`tools: designer`, `tools: gamedev`, `tools: motion designer` — all media-generation
(image/video/audio/3D) or gamedev/product templates, plus two QCAI-IDE-config
templates (`dev_edit_project_config_yaml`, `dev_plug_dynamic_ui_panel_into_qcai_ide`)
and one dynamic-data-UI template. None apply to writing a React+Vite+TS SPA against a
fixed REST/WS contract. **No template matches → custom approach**, following the stack
BUILD_PLAN.md §5 already mandates (React 18, Vite, hand-rolled CSS, React Router,
native fetch/WebSocket, no new deps beyond what's scaffolded). Every step below is
tagged `[skill: none]` for this reason — restated once here, not per line rationale.

Archetype badge glyphs are plain inline SVG (4 static monochrome geometric marks), not
AI-generated art, so no designer/image template applies there either — consistent with
DESIGN.md's "hand-rolled" system.

## Task Checklist

### Phase 0 — Research
- [x] Read `docs/ARCHITECTURE.md`, `docs/BUILD_PLAN.md`, `docs/DESIGN.md` `[skill: none]`
- [x] Inspect existing `web/` scaffold (package.json, vite.config.ts, tsconfig.json,
      index.html, src/App.tsx, src/main.tsx, src/styles/tokens.css, .env.example) `[skill: none]`
- [x] Confirm no matching skill/template exists (see above) `[skill: none]`

### Phase 1 — Foundations
- [x] `src/vite-env.d.ts` — Vite client types + `ImportMetaEnv` for `VITE_API_URL`/`VITE_WS_URL` `[skill: none]`
- [x] `src/types/index.ts` — TS types mirroring ARCHITECTURE §2 models + §5 request/response shapes `[skill: none]`
- [x] `src/lib/api.ts` — fetch client (`credentials: "include"`, base `VITE_API_URL`), one typed function per §5 endpoint `[skill: none]`
- [x] `src/lib/ws.ts` — WebSocket client wrapper (connect, subscribe additive channels, typed event dispatch) per §5.9 `[skill: none]`
- [x] `src/lib/format.ts` — elapsed-time / "friends for N days" / date helpers `[skill: none]`
- [x] `src/context/AuthContext.tsx` — current user via `GET /auth/me`, login/logout, dev-login `[skill: none]`
- [x] `src/context/RealtimeContext.tsx` — owns the WS connection once authed; presence map, friend-request events, per-profile wall subscription `[skill: none]`

### Phase 2 — Layout & UI kit (tokens-only, no hardcoded colors)
- [x] `components/ui/Button.tsx` (primary/secondary/ghost per DESIGN.md) `[skill: none]`
- [x] `components/ui/Card.tsx` `[skill: none]`
- [x] `components/ui/Avatar.tsx` (circle, serif-initial fallback) `[skill: none]`
- [x] `components/ui/Badge.tsx` (pill badges) `[skill: none]`
- [x] `components/ui/ArchetypeGlyph.tsx` (4 static monochrome SVG glyphs) `[skill: none]`
- [x] `components/ui/StatusDot.tsx` `[skill: none]`
- [x] `components/ui/Input.tsx` / `Textarea.tsx` `[skill: none]`
- [x] `components/ui/StatTile.tsx` `[skill: none]`
- [x] `components/layout/TopBar.tsx` `[skill: none]`
- [x] `components/layout/AppLayout.tsx` `[skill: none]`
- [x] `components/ProtectedRoute.tsx` `[skill: none]`
- [x] `components/ProjectCard.tsx`, `WallComment.tsx`, `FriendListItem.tsx`, `LinkIcon.tsx` `[skill: none]`

### Phase 3 — Pages (all pages from BUILD_PLAN §5 build order)
- [x] `pages/LoginPage.tsx` — GitHub OAuth button + dev-login form gated `import.meta.env.DEV` `[skill: none]`
- [x] `pages/HomePage.tsx` — feed/dashboard: live friend presence (WS), pending friend
      requests summary, quick nav `[skill: none]`
- [x] `pages/ProfilePage.tsx` — hero (avatar/name/archetype/status), links, wall,
      projects grid, stats + friend-compare (BUILD_PLAN item 6 folded in here) `[skill: none]`
- [x] `pages/FriendsPage.tsx` — friend list w/ "friends for N days", incoming/outgoing
      requests, add-by-username `[skill: none]`
- [x] `pages/ProjectsPage.tsx` — own projects manage (create/edit/delete), like counts `[skill: none]`
- [x] `pages/SettingsPage.tsx` — profile edit, avatar upload, external links editor,
      tracker token management `[skill: none]`

### Phase 4 — Wiring
- [x] `App.tsx` — router with all routes + `ProtectedRoute` (login public; `/`, `/friends`,
      `/projects`, `/settings`, `/u/:username` protected; catch-all redirects `/`) `[skill: none]`
- [x] `main.tsx` — wrap `AuthProvider` → `RealtimeProvider` → `BrowserRouter` `[skill: none]`

### Phase 5 — Verify
- [x] `npm install` inside `web/` (isolated, matches Railway's per-service Root Directory —
      ARCHITECTURE §8; avoids touching `server/`/`tracker/` node_modules) `[skill: none]`
- [x] `npm run build` (tsc -b && vite build) — passed clean, 80 modules, no TS errors `[skill: none]`
- [x] Fix any TS/build errors — none found `[skill: none]`

### Phase 6 — Monochrome correction (this pass)
GOAL: A prior pass had drifted `tokens.css`/`DESIGN.md` into a terracotta "Claude brandbook"
palette that contradicts the frozen `BUILD_PLAN.md §5` contract ("strict monochrome... no hue
is ever introduced by any component"). Corrected against the exact palette supplied by the
project owner. Re-ran `ToolGetTemplates` for this pass too — same catalog (media-gen +
QCAI-IDE-config templates only) — no match, custom approach confirmed again `[skill: none]`.
- [x] `src/styles/tokens.css` — rewritten to zero-hue grayscale values, every existing token
      name preserved; dark theme applied via both `@media (prefers-color-scheme: dark)`
      (`:root:not([data-theme="light"])`) and explicit `:root[data-theme="dark"]`, values kept
      in lockstep; serif/sans/mono font stacks and radii untouched; header comment refreshed `[skill: none]`
- [x] `docs/DESIGN.md` — color-bearing sections only (Mood, Palette, Components' color
      language, Logo usage) rewritten to match; typography/shape/layout/voice prose untouched `[skill: none]`
- [x] Grepped all of `src/**/*.{css,tsx}` for hex/rgb/hsl — every hardcoded color lived only
      in `tokens.css` (now fixed); components already reference `--vh-*` exclusively, so no
      other file needed edits `[skill: none]`
- [x] `index.html` — added `<meta name="color-scheme" content="light dark">`; fixed the
      long-broken `/vibehub-icon.png` favicon reference by copying
      `assets/branding/icon.png` (read-only source) into `web/public/vibehub-icon.png` `[skill: none]`
- [x] `web/.env` created for local dev (mirrors `.env.example`) `[skill: none]`
- [x] `Dockerfile` reviewed — `serve -s dist` already does SPA-fallback serving correctly,
      no change needed `[skill: none]`
- [x] Rebuilt clean after the token/doc changes — same 80-module clean build `[skill: none]`

## Success Criteria
- [x] All 6 pages implemented, routed, using only `--vh-*` tokens (no hardcoded colors)
- [x] Realtime presence/friend-request/wall events wired via WS per ARCHITECTURE §5.9
- [x] `npm install` and `npm run build` succeed for `web/`
- [x] No files touched outside `web/` (except `docs/DESIGN.md` color section and this plan file,
      both explicitly in-scope for this pass; `server/`, `tracker/`, `macos/` untouched)
- [x] UI is strictly monochrome (zero hue) in both light and dark themes, per the supplied palette
