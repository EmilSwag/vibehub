---
SECTION_ID: plans.vibehub_menubar_mac
TYPE: plan
STATUS: completed
PRIORITY: high
---

# VibeHub macOS Menu-Bar Companion (`menubar-mac`)

GOAL: A native SwiftUI menu-bar app that shows live VibeHub presence, today's activity
and friends-online, fed by a new tracker-token-authenticated `GET /api/v1/tracker/me`.
Ship it with a reproducible bundle script and a GitHub Actions release pipeline.

SCOPE: `server/`, new `menubar-mac/`, new `.github/workflows/`, `docs/ARCHITECTURE.md`,
root `README.md`, this plan.

OUT OF SCOPE (hard constraint from the PO): `web/` is not touched — not one file. No
`git commit`, no `git push`. The tracker (`tracker/`) and the existing `macos/` app are
also left alone.

TEMPLATE CHECK: Queried QCAI `ToolGetTemplates` for `type="developer"` and
`type="skills: quadcode.ai"`. Viable candidates read in full with
`ToolGetTemplateContent`:
  - `emil_design_eng` — **applied.** Its rules explicitly cover "macOS menu-bar
    companion mirrors the same rules": strict monochrome (zero hue), one primary action,
    terse copy, native 14–15px system type, loading/empty/error state for every data
    block. This drives the popover design in §3 below and matches the PO's "monochrome,
    calm like the web" wording.
  - `dev_create_meta_ui_to_work_with_project_data_using_html_js` — **not used.** The
    deliverable is a native app plus a server route, not a viewer over project data, and
    the repo's `ui_views/` convention lives under the frozen `web/` tree.
  - `dev_edit_project_config_yaml`, `dev_plug_dynamic_ui_panel_into_qcai_ide`,
    `create_skill` — not applicable (QCAI IDE config / panels / skill authoring).
No QCAI template covers Swift, SwiftPM packaging or GitHub Actions, so those are
hand-written against the repo's existing contracts. Claude Code skill aliases are
tagged per step.

## Corrections to the spec as given (verified against the repo)

- [x] **Paths.** The git root *is* `vibehub/` (`origin` = `EmilSwag/vibehub.git`), so
      the spec's `vibehub/menubar-mac/**` is `menubar-mac/**` in-repo and
      `vibehub/README.md` is `README.md`. The workflow `paths:` filter must use
      `menubar-mac/**` or CI would never fire.
- [x] **`docs/API.md` does not exist** (only `BUILD_PLAN.md`, `ARCHITECTURE.md`,
      `DESIGN.md`). Spec 1 said "document in docs/API.md if i…" (message truncated).
      Decision: document the route in `docs/ARCHITECTURE.md`, which is where the other
      tracker wire formats already live (§3/§4.3/§5.8, cited by `routes/tracker.ts`).
      Creating a one-route `API.md` would fragment the contract.
- [x] **`?connect=1` is not handled by the web app.** No occurrence in `web/src`; the
      only "connect" is an onboarding *step* name. The "Go online" action will open the
      site with an inert query param. Recorded as an external dependency — `web/` is
      frozen for this workstream, so it is documented, not fixed.
- [x] **Spec 4 truncated** at "create a GitHub Release with t…" — read as "with the
      zip attached as a release asset".
- [x] **No test framework exists.** `server/package.json` has no test runner and no
      `test` script; the house style is hand-rolled `*.check.ts` assertion scripts under
      `__checks__/`, run with `npx tsx`, exiting non-zero on failure (see
      `web/src/lib/__checks__/format.check.ts`). "Tests in the existing style" therefore
      means a `.check.ts`, not Jest/Vitest.

## Task Checklist

### 1. Server — `GET /api/v1/tracker/me`

- [x] Extract a pure, DB-free payload builder `lib/tracker-me.ts` →
      `buildTrackerMePayload(rows)` so the shape is assertable without a database; the
      route stays a thin fetch-then-build. This is the testable seam. [skill: none]
- [x] Add the route to `routes/tracker.ts` beside `/tracker/verify`, using
      `requireTrackerToken` (same Bearer auth and same 401 shape as
      `POST /tracker/heartbeat`); read the user from `req.trackerUserId`.
      Mount point is already `/api/v1` (`index.ts:124`), so the path resolves exactly.
      [skill: none]
- [x] Reuse existing helpers, do not re-derive: `presenceFor()` (`lib/sessions.ts`) for
      `presence`, `computeLevel()` (`lib/level.ts`) for `user.level`, `utcDay()` for the
      today window, and
      the `activeSecondsToday`/`tokensToday` assembly already proven in
      `GET /users/me/tracker` (`routes/users.ts`). `toPublicUser()` is deliberately NOT
      reused: it returns bio/archetype/roles/isDevAccount/createdAt, none of which the
      menu bar renders, and the spec's `user` block is a narrower five-field shape.
      [skill: none]
- [x] **Carry the Round 5 trap forward:** `tracker.connected`/`lastSeenAt` must come
      from heartbeat presence, *never* from `TrackerToken.lastUsedAt` — that field is
      bumped by `/tracker/verify` (and by this very route's middleware), which is what
      made `connected` flip true at login time and hide the Home banner. `devices[]`
      keeps using the non-revoked `TrackerToken` rows for `name`/`lastSeenAt`.
      [skill: none]
- [x] `friendsOnline`: count + `sample` capped at 4 (what the popover renders), built
      from `Friendship` both-directions like `routes/friends.ts`; bounded fan-out.
      [skill: none]
- [skipped: no input to validate] zod schema in `lib/schemas.ts`. Every zod schema in
      this codebase parses *inbound* data (`heartbeatSchema` on a body,
      `createTrackerTokenSchema`, `suggestedUsersQuerySchema`). `GET /tracker/me` takes no
      body, no params and no query — auth is the whole input — so a `trackerMeSchema`
      would validate nothing. The response shape is instead pinned by
      `__checks__/trackerMe.check.ts`, which is stronger than a zod type here.
      [skill: none]
- [x] Never spread a raw `User` row — the route `select`s only
      `{ id, username, displayName, avatarUrl }`, so `githubAccessToken` and
      `passwordHash` cannot leak (ARCHITECTURE.md §3). [skill: none]
- [x] `server/src/lib/__checks__/trackerMe.check.ts` — plain assertions over
      `buildTrackerMePayload` in the `format.check.ts` style: presence
      active/idle/offline, `model: null` degradation, connected-vs-token-lastUsed,
      empty friends, friends sample capped at 4, zero-activity day. [skill: none]
- [x] `npm run build --workspace server` + run the check with `npx tsx`; both green.
      [skill: none]

### 2. Server — `lib/links.ts` telegram icons

- [x] Add `t.me`, `telegram.org`, `www.telegram.org` → `"telegram"` to `ICON_MAP`
      (the `www.` variant matches the convention every other host in the map follows).
      [skill: none]
- [x] Note in the plan output that the web's icon renderer needs a matching `telegram`
      glyph — `web/` is frozen, so this is a handoff, not a change here. [skill: none]

### 3. Mac app — `menubar-mac/`

- [x] SwiftPM package, executable target `VibeHubMenuBar`, macOS 13+, **zero
      dependencies** (URLSession + Codable only). [skill: none]
- [x] `MenuBarExtra` with `.menuBarExtraStyle(.window)`; `LSUIElement` true so no Dock
      icon. Bar item = 16px monochrome SF Symbol template glyph + optional compact
      "2h 14m" today-active text behind a settings toggle. [skill: emil-design-eng]
- [x] Popover ~320pt, system colours + SF Symbols only, zero hue (`emil_design_eng` §3):
      header (avatar, display name, `@username`, presence dot — filled green only when
      active, grey when idle, hollow when offline); "Now" line `project · tool · model`
      with a live `since` timer; "Today" with live-ticking active time while active,
      plus tokens and level; "Friends online: N" with up to 4 avatars/names.
      [skill: emil-design-eng]
- [x] Every block gets a loading / empty / error state (`emil_design_eng` §5): shape-
      matched placeholder, one-sentence empty state, inline error with retry — no
      spinners for content. [skill: emil-design-eng]
- [x] Polling: 15s with the popover closed, 3s while open, exponential back-off while
      offline/erroring, reset on success. [skill: none]
- [x] Token in the **Keychain** (`kSecClassGenericPassword`), never `UserDefaults`.
      [skill: none]
- [x] Actions: Open VibeHub · Go online (`…/?connect=1`) · Copy tracker token ·
      Settings · Quit. Settings = token field, show-time-in-bar toggle, launch-at-login
      via `SMAppService`. [skill: none]
- [x] First run: empty state with a "Paste your tracker token" field and a pointer to
      Settings → Tracker on the web, where tokens are minted. [skill: none]
- [x] Base URL defaults to the Railway deployment and stays overridable at runtime via
      `UserDefaults` (same pattern the existing `macos/` app settled on). [skill: none]

### 4. Packaging + CI

- [x] **Decision: plain SwiftPM + `menubar-mac/scripts/bundle.sh`, not XcodeGen.** The
      Swift toolchain is preinstalled on `macos-14` runners; XcodeGen would add a
      `brew install` step and a third-party version to pin, for a single-target app with
      no storyboards or asset catalogs to justify a project file. Fewer moving parts =
      builds more reliably, which is the criterion the spec set. [skill: none]
- [x] `bundle.sh`: assemble `VibeHub MenuBar.app` (Info.plist with `LSUIElement`,
      binary, icon), ad-hoc sign `codesign --force --deep -s -`, zip. [skill: none]
- [x] **Icon:** generate the `.icns` at build time from a small CoreGraphics drawing
      (`scripts/make-icon.swift`) → `.iconset` PNGs → `iconutil -c icns`. Uses only
      preinstalled macOS tooling — no SVG rasterizer to install, no binary blob in git,
      and it can't be produced or verified from this Windows session anyway.
      [skill: none]
- [x] `.github/workflows/menubar-mac.yml` — `on: push` filtered to `menubar-mac/**`
      (repo-relative, see Corrections) plus `workflow_dispatch`; `macos-14`; build
      release → bundle → zip → upload artifact `VibeHub-MenuBar-macOS.zip`. [skill: none]
- [x] On tag `menubar-v*`, also create a GitHub Release with the zip attached.
      [skill: none]

### 5. Docs

- [x] `menubar-mac/README.md`: what it shows; install (unzip → drag to Applications →
      right-click Open the first time, because it is ad-hoc signed and unnotarized); how
      to get a tracker token; how to update. [skill: none]
- [x] Short "macOS menu bar" section in root `README.md` linking the folder.
      [skill: none]
- [x] Document `GET /api/v1/tracker/me` in `docs/ARCHITECTURE.md` next to the other
      tracker routes. [skill: none]

### 6. Verification (Windows session — no Swift toolchain)

- [x] Server: build + `.check.ts` actually run and green. [skill: none]
- [x] Swift: hand-review every file for type errors, optionality, `Codable` key
      alignment against the real JSON, `@MainActor` isolation and retain cycles — no
      compiler available. [skill: code-review]
- [x] Validate `menubar-mac.yml` and `Info.plist` by parsing them (YAML/plist parse,
      not eyeballing). [skill: none]
- [x] Self-review the whole diff for scope creep: assert zero edits under `web/` and no
      commits. [skill: code-review]

## Success Criteria

- [x] `GET /api/v1/tracker/me` returns the full specified shape, 401s on a bad/revoked
      token, and reuses presence/level/today helpers rather than duplicating them.
- [x] `connected` is heartbeat-derived, not `lastUsedAt`-derived.
- [x] Server build and the new check both pass.
- [x] `t.me` and `telegram.org` resolve to `telegram`.
- [x] Swift sources are internally consistent and match the endpoint's JSON exactly.
- [x] Workflow YAML and Info.plist parse; path filter is `menubar-mac/**`.
- [x] Zero files changed under `web/`; nothing committed or pushed.

## Known-unverifiable in this session

- Swift compilation, app launch, menu-bar rendering, Keychain access, `SMAppService`
  launch-at-login, `.icns` generation, `codesign`, and the CI run itself — all require
  macOS. Documented for the PO rather than claimed.

## Amendment 1 — what verification actually turned up (2026-09-07)

Executed on Windows with no Swift toolchain, so "verified" below means what was actually
run, and §Known-unverifiable still stands for everything needing macOS.

**Ran green:**
- `npm run build --workspace server` — clean.
- `npx tsx server/src/lib/__checks__/trackerMe.check.ts` — 32 passed, 0 failed.
- `Info.plist` parsed with `plistlib`; asserted `LSUIElement == true`,
  `CFBundleExecutable == VibeHubMenuBar`, `CFBundleIconFile == AppIcon`.
- `.github/workflows/menubar-mac.yml` parsed with PyYAML; asserted the path filter is
  `menubar-mac/**`, the tag filter is `menubar-v*`, and `permissions: contents: write`.
- **Swift↔server contract diff** (substitute for a compiler on the surface that matters):
  generated a real payload from `buildTrackerMePayload`, parsed every `struct` out of
  `TrackerMe.swift`, and asserted the key sets match exactly at all nine levels, that
  `Friend.id` is a computed Identifiable shim rather than a decoded field, that all three
  `PresenceStatus` cases are covered, and that every timestamp is the fractional-seconds
  ISO form `APIClient`'s custom decoder expects. Result: CONTRACT MATCH.

**Three defects found by hand-review and fixed:**
1. `Format.toolLabel` built a title-cased word with `String + Substring` — no such
   overload; wrapped the tail in `String(...)`.
2. `scripts/make-icon.swift` used `try` at top level with nothing to handle the throw;
   replaced with explicit `do`/`catch` and a `fail()` helper.
3. `VibeHubMenuBarApp` constructed two `@MainActor` objects in `init()` and read
   `@MainActor` state from the nonisolated `barText`; annotated the struct `@MainActor`.

**Deliberate deviations from the spec as written**, all recorded in §Corrections:
repo-relative paths (`menubar-mac/**`, not `vibehub/menubar-mac/**`); ARCHITECTURE.md
§5.8 instead of a new `docs/API.md`; a `.check.ts` instead of a test framework the repo
does not have; SwiftPM + `bundle.sh` chosen over XcodeGen.

**Open handoffs (both outside this workstream's scope):**
- `?connect=1` is inert — `web/` never reads it, so the "Go online" action currently just
  opens the home page.
- `web/`'s link-icon renderer needs a `telegram` glyph to match the new `ICON_MAP` entries.
- `docs/ARCHITECTURE.md` §5.8 still omits `GET /api/v1/tracker/verify`, which predates
  this work; left alone to keep the diff tight.
