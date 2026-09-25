# Lane A (Archy) — VibeHub for Mac: changed files, deviations, verification

Session: 2026-09-19. Windows workstation, no Swift toolchain — everything below is
**static review only** (re-read every source, ran the checks a Windows box actually
can). Nothing here was compiled, run, committed, pushed, or released. Scope: own only
`vibehub/mac/**` and `vibehub/.github/workflows/mac.yml`, per
`Vibemunity/meta/plans/vibehub-mac-app.md`'s lane split.

## Audit pass (same session, follow-up)

A second pass audited `TrackerManager`/`LaunchAgent` against an explicit, tighter
contract, and re-checked Xcode 15/macOS 13 API signatures across the new AppKit code.
Found and fixed one real compile hazard and several behavioural gaps:

- **`NSApplicationDelegateAdaptor(wrappedValue:)` — not a real initializer.** The
  first pass's `VibeHubApp.init()` called
  `_appDelegate = NSApplicationDelegateAdaptor(wrappedValue: delegate)` to pre-configure
  the delegate before assignment, copying the `@StateObject`/`@State` pattern. Unlike
  those wrappers, `NSApplicationDelegateAdaptor` has no `init(wrappedValue:)` overload —
  only `init(_ delegateType: DelegateType.Type = ...)` — so that line would not have
  compiled. Fixed: declared `@NSApplicationDelegateAdaptor(AppDelegate.self) private var
  appDelegate` (the attribute argument *is* the supported way to give it a default,
  applied automatically before `init()`'s body runs) and configure
  `appDelegate.onOpenURLs` as an ordinary statement inside `init()`, after `tracker`/
  `store` exist, instead of trying to build the delegate before the property exists.
- **`login(token:)`** now times out at 30s (was 20s) and only succeeds on exit 0 *and*
  a stdout line starting with `"Logged in as "` — no longer treats the CLI's
  unverified-but-saved `"Wrote ..."` case as success (see Deviations below; this
  reverses the first pass's deliberate leniency there, on explicit instruction).
- **`TrackerManager` now polls `status.json`/`tracker.pid` every 5s** on its own
  (`startPolling()`, called once from `VibeHubApp.init()`), not just on-demand from
  popover `onAppear` and after actions.
- **`LaunchAgent.install`** now sets `ThrottleInterval: 30`, an explicit
  `EnvironmentVariables: { HOME }`, and a single `~/.vibehub/launchd.log` for both
  stdout/stderr (was two separate `.out.log`/`.err.log` files), and enables via the
  explicit sequence `bootout` → write plist → `bootstrap` → `kickstart -k` (was
  `bootstrap` alone after an `uninstall()`).
- **`TrackerManager.disableTrackAtLogin()`** now also runs the embedded CLI's `stop`
  command (best-effort) after tearing down the LaunchAgent, so an already-running
  daemon closes its session and writes `status.json` back to offline instead of just
  losing its supervisor.
- **`Handoff`'s `apiUrl` is now actually used.** The first pass parsed and stored
  `HandoffToken.apiUrl` but nothing ever read it back — `login()` always used
  `settings.baseURL`. Fixed: `TrackerManager.adopt(_:)` remembers a handoff's `apiUrl`
  in memory (`handoffApiUrl`), consulted by `login()` ahead of `settings.baseURL`.
  Re-audited for secret handling at the same time: the token is written straight to
  the Keychain and to nowhere else (it does reach the embedded CLI's argv, same as the
  CLI's own documented interface — not something this lane's code introduces or can
  avoid); no `print`/`NSLog` exists anywhere in `Sources/VibeHub/` (grepped); every
  `lastActionError` assignment is either a static description or the tracker CLI's own
  stdout/stderr, which — per its source — never echoes the token back.

## Milestones (plan's Lane A checklist)

- [x] App identity: product renamed to VibeHub (`.app`, `CFBundleName`, Swift target/binary), bundle id kept for Keychain continuity, `LSUIElement`, `vibehub://` URL scheme
- [x] `TrackerManager` + `LaunchAgent`: embedded node+cjs paths, `login` (strict success check, 30s timeout), 5s `status.json`/`tracker.pid` poll, LaunchAgent bootout/bootstrap/kickstart with `ThrottleInterval`/`HOME`/single log, disable also runs `cjs stop` — audited and fixed against an explicit contract, see "Audit pass" below
- [x] `Handoff`: `~/.vibehub/handoff.json` consumer + `vibehub://connect` deep link
- [x] Onboarding wizard: Welcome → Token → Start tracking → Done (island preview)
- [x] Island: notch-hugging floating panel (notch-derived size, 60/250ms hover, click-toggle, Escape, screen-change recalc, `statusBar+1`/shadowless/borderless panel), Auto/Always/Off — audited against an explicit layout/interaction contract, see "Island audit pass" below
- [x] Popover: tracker row, "Track at login" toggle, Island picker, ≈$ today
- [x] pkg: `make-pkg.sh`, `Distribution.xml`, welcome/conclusion HTML, postinstall
- [x] CI: universal build, embedded-Node download+lipo, optional signing/notarisation, pkg, sha256, artifacts, release on `mac-v*`
- [*] Real-Mac verification — cannot be done from this workstation (plan's own Verification section already says so); see "What still needs a real Mac" below
- [ ] Lane B's `serve` command — not this lane's job, but Island/TrackerManager assume it exists; see Deviations

## Changed files

Everything below is staged (not committed). Renames are relative to the prior
session's `menubar-mac/` → `mac/` migration, which was staged but not committed
before this session started (confirmed via `git status` at the start — the workflow
file rename and the whole `menubar-mac/`/`macos/` → `mac/` move) and is preserved
as-is here, just built on top of.

**New:**
- `Sources/VibeHub/TrackerManager.swift` — embedded tracker process control, local status reading
- `Sources/VibeHub/LaunchAgent.swift` — `~/Library/LaunchAgents/com.vibehub.tracker.plist` write/bootstrap/bootout
- `Sources/VibeHub/Handoff.swift` — `handoff.json` + `vibehub://connect` parsing
- `Sources/VibeHub/IslandController.swift` — the floating panel: `NSPanel`, notch-derived placement/sizing, `NSEvent` global/local monitors for hover/click/Escape, frame animation, screen-change recalculation (rewritten in the Island audit pass — see below)
- `Sources/VibeHub/IslandView.swift` — `IslandView` (expanded 420×260 card + footer), `IslandPill` (collapsed, notch-flanking), `IslandPreview` (onboarding) (rewritten in the Island audit pass)
- `Sources/VibeHub/OnboardingWizard.swift` — the 4-step first-run flow
- `.gitignore` (in `mac/`) — `.build/`, `.swiftpm/`, `dist/`, `.cache/` (see Deviations — the top-level one is stale/incomplete for this dir, but out of lane)
- `scripts/embed-tracker.sh` — downloads/verifies/lipos the private Node runtime, copies `vibehub-tracker.cjs`, into an app-bundle-shaped directory
- `scripts/make-pkg.sh` — `pkgbuild` + `productbuild` → `VibeHub.pkg` + `.sha256`
- `pkg/Distribution.xml`, `pkg/resources/welcome.html`, `pkg/resources/conclusion.html`, `pkg/scripts/postinstall`
- `CHANGES.md` — this file

**Rewritten:**
- `Sources/VibeHub/VibeHubApp.swift` (renamed from `VibeHubMenuBarApp.swift`) — `AppDelegate` for URL-scheme handling, wires up `TrackerManager`/`IslandController`/`Handoff`, moves `store.start()`/`tracker.startPolling()` into `init()` (see Deviations — a real latent bug fix); audit pass fixed the `NSApplicationDelegateAdaptor` wiring itself (see Audit pass above)
- `scripts/bundle.sh` — universal build (`--arch arm64`/`--arch x86_64` + `lipo`), embeds the tracker, renamed artifacts, optional Developer ID signing
- `.github/workflows/mac.yml` — was still internally saying `menubar-mac`/`menubar-v*` despite the file itself being renamed; full rewrite: `mac/` paths, `mac-v*` tags, universal-build verification, pkg build + verify, optional signing/notarisation secrets, updated release notes and artifact names
- `README.md` — full rewrite for the new product surface (Island, tracker ownership, pkg, one-command, signing secrets table)

**Lightly edited:**
- `Package.swift` — target renamed `VibeHubMenuBar` → `VibeHub`, path `Sources/VibeHub`
- `Resources/Info.plist` — `CFBundleExecutable`/`CFBundleName` → `VibeHub`, added `CFBundleURLTypes` (`vibehub` scheme), version bumped to `0.2.0`, a comment explaining why the bundle id is unchanged
- `Sources/VibeHub/AppSettings.swift` — added `IslandMode` enum + `islandMode`/`hasCompletedOnboarding` published settings, `import Combine`
- `Sources/VibeHub/TrackerMe.swift` — added optional `Today.estimatedUsd`/`byModel` (server-forward-compatible; decodes to `nil` until lane B ships them)
- `Sources/VibeHub/Format.swift` — added `compactUsd`, `parseISO8601`
- `Sources/VibeHub/OnboardingView.swift` — added optional `onSaved` callback (used by the wizard; `nil` default keeps the plain "re-enter token" use unchanged)
- `Sources/VibeHub/PopoverView.swift` — `tracker` param, onboarding-wizard gate, tracker status row, ≈$ in the Today stat row
- `Sources/VibeHub/SettingsView.swift` — `tracker` param, "Track at login" toggle, Island picker

**Renamed only (content unchanged), swept along with the file layout:**
`Sources/VibeHub/APIClient.swift`, `Components.swift`, `Keychain.swift`, `StatusStore.swift`, `scripts/make-icon.swift`.

**Untouched, deliberately left to their owners:**
`pkg/resources/background.png`/`@2x` (lane D). `make-pkg.sh` / `Distribution.xml`
both check for these at build time and produce a plainer-but-working installer
without them.

## Island audit pass (same session, second follow-up)

A third pass rewrote `IslandController`/`IslandView` against an explicit, detailed
layout/interaction contract, replacing significant parts of the first pass's design.

**Implemented as specified:**
- Screen selection: a notch display if one exists (`auxiliaryTopLeftArea`/
  `auxiliaryTopRightArea` both non-nil), else `NSScreen.main`.
- Collapsed size: width = notch width (from the auxiliary areas' gap) + 168; height =
  `screen.safeAreaInsets.top` when positive, else 32. No notch -> 0 + 168 = 168 wide.
- Collapsed layout: left cluster presence dot + today's time, right cluster tokens
  (+ ≈$ appended when the server sends it) — the two clusters flank the panel's actual
  edges via a `Spacer` in an edge-to-edge `HStack`, so the flexible middle gap lines up
  with the real hardware notch the panel spans.
- Expanded: 420×260, reusing the same four data sections (header/Now/Today/friends)
  plus a new footer, with Quit deliberately excluded (see Deviations).
- Bottom-only 16pt corners (`UnevenRoundedRectangle`, top radii 0) on both states —
  the panel is flush against the screen's top edge, so only the bottom needs rounding.
- Top anchoring (both states share the same top-edge-flush, horizontally-centred-on-
  notch origin formula) is now a hard requirement in `applyFrame`, not just a default.
- Hover/click/Escape rebuilt on `NSEvent.addGlobalMonitorForEvents`/
  `addLocalMonitorForEvents` (mouseMoved, leftMouseDown, keyDown), replacing the first
  pass's `NSTrackingArea`-based `IslandHostingView` entirely — a nonactivating panel
  that never becomes key wouldn't reliably see view-level tracking events while another
  app is frontmost, which is the normal case here.
- Hover timing: 60ms before expanding, 250ms before collapsing (was a single 150ms
  collapse-only debounce).
- Click anywhere on the panel toggles expanded/collapsed; Escape collapses (see the
  Input Monitoring caveat below).
- `NSApplication.didChangeScreenParametersNotification` triggers an unanimated
  `applyFrame` recompute (display added/removed/resolution change/notch geometry
  change).
- Default Island mode remains `.auto` (unchanged, re-verified in `AppSettings.init`).
- `NSPanel`: `.nonactivatingPanel, .borderless`; level `.statusBar.rawValue + 1`;
  `hasShadow = false` (was `true` — flipped); `isOpaque = false`; `backgroundColor =
  .clear`; `hidesOnDeactivate = false`; `isMovable = false`; collection behavior
  `[.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]`.
- Reduced motion: `NSWorkspace.shared.accessibilityDisplayShouldReduceMotion` gates
  both the panel-frame animation (`applyFrame` skips `NSAnimationContext` and just
  `setFrame` instantly) and the SwiftUI content spring (`@Environment(\.
  accessibilityReduceMotion)` in `IslandView`, animation set to `nil`).

**Deviations, and why:**

1. **No true spring for the window frame.** `NSAnimationContext` only exposes
   `duration` + `CAMediaTimingFunction` (a cubic bezier) for an animator-proxy frame
   change — there's no spring-physics hook, unlike SwiftUI's `Animation.spring`. The
   contract's `spring(0.35, 0.8)` is applied verbatim to `IslandView`'s
   `.animation(...)` (the SwiftUI content swap, where real spring physics are
   available); the window frame itself uses `NSAnimationContext` with a 0.35s duration
   and a strong ease-out bezier chosen to visually approximate that spring's settle
   time and near-critical damping, not an exact match. A pixel-perfect match would need
   a manually-driven, per-frame `CASpringAnimation`-based resize loop — a much larger
   change than this contract's scope, and unverifiable from here regardless.
2. **Escape-to-collapse is implemented but may not fire in practice.** Global
   `keyDown` monitoring (`NSEvent.addGlobalMonitorForEvents`) requires this app to be
   granted Input Monitoring in System Settings -> Privacy & Security; VibeHub doesn't
   request that permission, so macOS silently drops the event rather than delivering
   it. The local monitor is equally unlikely to help: a `.nonactivatingPanel` never
   becomes key, and keyDown delivery normally requires a key window. Implemented both
   monitors per the contract (code is correct and ready if permission is ever granted,
   or if local delivery works in some case not anticipated here), but flagging this as
   a real, unverified gap — only a real Mac can confirm whether Escape does anything at
   all today. Mouse-based hover/click are unaffected by this restriction.
3. **"Reused header/Now/Today/friends/footer" interpreted as shared components, not
   shared View code.** `IslandView`'s sections use the same underlying pieces as
   `PopoverView` (`Avatar`, `PresenceDot`, `SectionLabel`, `Format`'s helpers) and
   mirror the same four sections plus a new footer, but are Island's own container
   views, not literal calls into `PopoverView`'s private methods. Island is
   permanently dark; the popover follows the system appearance — sharing the exact
   view-builder methods would require threading a colour-scheme parameter through
   `PopoverView` itself, which this Island-scoped contract doesn't ask for and which
   would touch code outside what was requested here.
4. **Footer button choice.** The contract says "footer" and "no Quit" but doesn't
   enumerate buttons. Chose "Open VibeHub" and "Go online" — `PopoverView`'s two
   non-destructive, non-settings actions — leaving "Copy tracker token" and "Settings"
   popover-only, on the same reasoning as excluding Quit (a decorative always-on-top
   panel is the wrong surface for token/settings management).
5. **`~260` treated as exactly 260** for the actual `NSPanel`/SwiftUI frame height,
   since a window needs a concrete size; content (header through footer, with a
   flexible `Spacer` above the footer) was checked to fit comfortably within it.
6. Monitors and the screen-parameter observer are now installed only while the panel
   is actually visible (tied to `showPanel`/`hidePanel`), not for the app's whole
   lifetime — not asked for explicitly, but avoids running a global event tap for a
   feature the user has set to Off.

**Verification for this pass:** re-read both rewritten files in full; `{`/`}` balance
even on both; grepped for leftover references to the removed `IslandHostingView` and
the old fixed `collapsedSize` constant — none found; grepped for `print(`/`NSLog(` —
still none anywhere in `Sources/VibeHub/`. `UnevenRoundedRectangle` and
`accessibilityReduceMotion` confirmed against Apple's documented macOS 13/SwiftUI-4
availability (both introduced at exactly that OS version, matching this target) —
recall-based, not compiler-verified, same caveat as the rest of this report.

## Deviations from the plan, and why

1. **`IslandPanel` → `IslandController`.** The plan sketches "`IslandPanel` (NSPanel) +
   `IslandView` + hover controller". Implemented as `IslandController` (an
   `NSObject`/`ObservableObject` that *owns* an `NSPanel`, doesn't subclass it — an
   `NSPanel` subclass would gain nothing here and "Controller" is the accurate name
   for what it does) + `IslandView`/`IslandPill`. The "hover controller" piece was
   originally a private `IslandHostingView` (`NSTrackingArea`-based); the Island audit
   pass (below) replaced that with `NSEvent` global/local monitors on
   `IslandController` itself, per that pass's explicit contract — so the hover logic
   now lives on the controller rather than a separate view subclass. Functionally
   matches the plan's three pieces either way; no other lane references these names.

2. **`TrackerManager.enableTrackAtLogin()` runs `login` first.** Not spelled out
   explicitly in the plan's one-line description, but necessary: without it, the
   LaunchAgent would bootstrap a `serve` process with no `~/.vibehub/config.json`,
   which every tracker command (`requireConfig()`, `tracker/src/config.ts`) refuses to
   run against. Found this while tracing the actual CLI contract in `tracker/src/`
   rather than assuming from the plan's prose alone — worth flagging since it's the
   kind of gap that would only show up as "Start tracking never actually starts
   anything" on a real Mac. Audit pass then tightened `login`'s own success test to
   exit 0 + a literal `"Logged in as "` line (was: exit 0 + any non-empty output,
   deliberately tolerant of the CLI's unverified-but-saved case) — "Start tracking"
   bootstraps a LaunchAgent on the strength of this result, so treating an unverified
   save as success would have hidden a bad token behind "successfully" running a
   daemon that can never actually connect.

3. **`store.start()` / `tracker.refreshLocalStatus()` moved from `PopoverView.onAppear`
   into `VibeHubApp.init()`.** `MenuBarExtra`'s `.window` style only builds its content
   (and fires `onAppear`) once the user first clicks the menu bar item — meaning the
   *pre-existing* app likely didn't start polling until first click either. That was a
   latent quirk, not a regression I introduced, but Island needs live data before any
   click ever happens, so fixing it was required, not optional.

4. **Handoff schema.** `~/.vibehub/handoff.json`'s exact shape isn't specified
   anywhere yet (lane C hasn't built `mac.sh`). Defined it as `{ "token": "...",
   "apiUrl": "..." }` (`apiUrl` optional) — the minimal shape the product decision's
   one sentence implies. `mac/README.md` and this file are the record of that
   contract for lane C to match; if C lands something different, only `Handoff.swift`
   needs to change.

5. **`serve` is assumed, not built.** `LaunchAgent.install` hardcodes
   `ProgramArguments: [node, cjs, "serve"]`. That command is lane B's, and doesn't
   exist in `tracker/` yet. Until it lands, "Start tracking" will bootstrap a
   LaunchAgent whose job fails immediately and gets retried every ~10s by launchd
   (harmless, but pointless) — expected and by design of the parallel-lane split, not
   a bug in this lane.

6. **Added `mac/.gitignore`.** Not asked for, but `mac/**` now produces `.build/`,
   `.swiftpm/`, `.cache/` (the Node download cache) locally, and the top-level
   `vibehub/.gitignore` only has stale entries for the deleted `macos/` dir — nothing
   for `mac/`. A scoped `.gitignore` inside this lane's own directory is the fix that
   doesn't touch a file outside `mac/**`.

7. **Kept the internal Swift module directory named `Sources/VibeHub`** (not
   `Sources/VibeHubMenuBar`) and renamed the executable target — this *is* a change
   beyond a strict "you don't have to rename internals" reading of the plan, but the
   plan's own first bullet says "rename product to VibeHub", and leaving the shipped
   binary named `VibeHubMenuBar` (visible in Activity Monitor, `ps`, crash reports)
   would be a half-rename. Every reference (`Package.swift`, `bundle.sh`,
   `Info.plist`) was updated together and grepped for stragglers afterward (see
   Verification).

## What still needs a real Mac (can't be done from here)

- Everything the plan's own Verification section already says needs a real Mac:
  pkg install → token prompt → Start → tracker survives reboot → Island shows data.
- **Island placement/behaviour specifically** — this is genuinely novel AppKit work
  (`NSScreen.auxiliaryTopLeftArea`/`auxiliaryTopRightArea`, `NSPanel` level/collection
  behavior, hover-driven frame animation) with nothing existing in this codebase to
  pattern-match against, unlike `TrackerManager` (mirrors a fully-documented CLI) or
  the pkg scripts (standard `pkgbuild`/`productbuild` recipes). Highest-uncertainty
  piece of this lane by a clear margin — and specifically:
  - Whether `NSEvent.addGlobalMonitorForEvents`/`addLocalMonitorForEvents` for
    `.mouseMoved`/`.leftMouseDown` actually deliver reliably for a `.nonactivatingPanel`
    that's never key, across every app-switching scenario.
  - Whether Escape does anything at all — depends on Input Monitoring permission this
    app doesn't request (see the Island audit pass's Deviation #2).
  - Whether the `NSAnimationContext` bezier approximation of `spring(0.35, 0.8)`
    actually feels close to it, or needs re-tuning by eye on a real display.
  - Whether `notchWidth + 168`/`safeAreaInsets.top` produce a pill that visually reads
    as "hugging the notch" rather than too wide/narrow/tall — pure geometry math,
    never rendered.
- `swift build --arch arm64 --arch x86_64` in one invocation vs. building each arch
  separately and `lipo`-ing them (chosen here, for exactly this reason — lower
  confidence in the combined-flag form without a toolchain to try it on).
- The Developer ID signing / notarisation steps in `mac.yml` — untestable without
  secrets, which don't exist in this repo yet. Ad-hoc signing (the existing,
  already-working path) is unaffected either way.
- `pkgbuild`/`productbuild`/`iconutil`/`lipo`/`codesign` themselves — Xcode-toolchain
  commands with no Windows equivalent to even approximate.

## Verification actually performed

- Re-read every file in `mac/**` in its final state (not just the diff) before
  writing this report, including files I didn't touch, to check the ones I did touch
  against them correctly (call sites, wire formats, existing conventions).
- Traced the real tracker CLI contract in `tracker/src/*.ts` (not just its README)
  for `TrackerManager`/`LaunchAgent`: `config.json`/`status.json`/`tracker.pid` shapes,
  `login`'s actual exit-code semantics, the detached-daemon model — this is what
  caught deviation #2 above.
- Cross-checked the embedded Node pins in `scripts/embed-tracker.sh` character-for-
  character against `web/public/tracker/connect.sh` and `runtime-manifest.json`
  (version, origin, both darwin SHA-256 values) — identical.
- `grep -r VibeHubMenuBar mac/` after the rename — zero stray references.
- Per-file `{`/`}` count balance across every Swift file in `Sources/VibeHub/` — even.
- `bash -n` (syntax-only, no execution) on all four new/rewritten shell scripts
  (`bundle.sh`, `embed-tracker.sh`, `make-pkg.sh`, `pkg/scripts/postinstall`) — all
  pass.
- `[xml]` parse (PowerShell) of `Resources/Info.plist` and `pkg/Distribution.xml` —
  both well-formed, including `Distribution.xml` with `__VERSION__` substituted and
  with the background-artwork elements injected, i.e. every shape `make-pkg.sh`
  actually produces at runtime, not just the file as committed.
- Checked for tab characters in `mac.yml` (YAML forbids them) — none.
- No `python3` available on this machine to validate the YAML directly or the
  `make-pkg.sh` Python snippet's syntax — reviewed both by eye instead; flagging
  since it's the one file format I couldn't mechanically check at all.
- No real commits, pushes, or CI/release runs were made. `git add` was used to stage
  the lane's files (matching the prior session's already-staged, not-yet-committed
  state at the start of this one) — nothing was committed.

**Audit pass, additionally:**
- `grep -rn "NSApplicationDelegateAdaptor(wrappedValue" Sources/VibeHub/` — zero
  matches, confirming the fix actually removed every instance of the bad call.
- `grep -rn "print(\|NSLog("  Sources/VibeHub/` — zero matches, before asserting "no
  secrets are ever logged" in the Audit pass notes above.
- Re-ran the per-file `{`/`}` balance check on the three files this pass touched
  (`TrackerManager.swift`, `LaunchAgent.swift`, `VibeHubApp.swift`) — even.
- Re-read `tracker/src/index.ts`'s `login` action line-by-line again to confirm the
  exact stdout shape on the success path (`Logged in as ${verified.detail}`) matches
  what the new strict check looks for, and that neither of its two error paths ever
  print the raw token.
- Did **not** re-verify `launchctl`'s exact accepted flag syntax (the `KeepAlive`
  value was later changed to `{ SuccessfulExit: false }` per plan FC1 — see the Round 4
  section below)
  (`bootstrap`/`bootout`/`kickstart -k`, `ThrottleInterval`/`EnvironmentVariables` plist
  keys) against a real `man launchd.plist`/`launchctl` — no macOS available here to
  check against; these are written from documented/well-known launchd conventions, not
  verified interactively. Flagging this explicitly as the one part of this pass that's
  knowledge-recall rather than a mechanical check, same caveat as the pkg/CI toolchain
  commands already listed above.

## Round 4 — N1–N7 static implementation, FC4 tokenless, Lumi integration (2026-09-21)

Static-only again (Windows, no Swift toolchain; explicitly authorised as such in the
plan's Round 4 — "compile happens in CI on `macos-14` after push"). Scope: `mac/**` and
`.github/workflows/mac.yml` only. Nothing compiled, installed, started, committed,
pushed or dispatched; no live tracker, personal log or `~/.vibehub` touched. Skills:
`ToolGetTemplates` over `developer`, `team leader`, `tools: developer`,
`skills: quadcode.ai`, `skills: product`; `emil_design_eng` read in full and applied to
N6, onboarding, Island and Settings; `dev_create_meta_ui_…` and `product_create_prd`
create files outside this lane and were not used. Lifecycle/CI work: no matching
template.

### Per-scope outcome (all static — nothing here has met a compiler)

- **N1 · Account/Keychain.** `TrackerManager.connect` is the single account-change
  path. When a *different* token arrives it boots the LaunchAgent out first, retires
  the old account (`stop` then `logout` — the CLI's own bounded, device-scoped
  connection DELETE and config removal), then `login --token-stdin`, Keychain write,
  and reinstall + `kickstart -k` (only if tracking was on and not user-disabled).
  `signOut()`: agent down → login item off → retire → Keychain cleared →
  `userDisabledTracking = true`. Settings' "Clear" is now "Sign out".
  `statusBelongsToCurrentAccount` compares `configFingerprint`.
- **N2 · Upgrade / retained Off.** `AppSettings.userDisabledTracking` +
  `lastRunBundleVersion`. `reconcileOnLaunch()` tears a present agent down when Off is
  retained; otherwise, when `CFBundleShortVersionString` changed, rewrites the plist
  and kickstarts. The version marker is written after the comparison, never before.
- **N3 · Location guard.** `isInApplicationsFolder` (`/Applications` or
  `~/Applications`, symlinks resolved) gates `enableTrackAtLogin` with a "move it
  first" error; an `SMAppService` failure surfaces as `launchAtLoginError`. The
  running-instance half is **not** implemented — see Deviations.
- **N4 · Island screens.** One `targetScreen()` (a notched display, else
  `NSScreen.screens.first`, never `NSScreen.main`) used by both `makePanel` and
  `applyFrame`; the notchless pill hangs *below* the menu bar; a full-screen heuristic
  orders the panel out; the screen-parameter observer recomputes without animation.
- **N5 · No keyboard hooks.** The global monitor is mouse-only. `IslandPanel`
  overrides `canBecomeKey`, so Escape is an ordinary local event after an explicit
  click; click-outside collapses. No Input Monitoring, Accessibility or screen capture.
- **N6 · Motion** [skill: emil_design_eng]. Expand 0.35s / collapse 0.2s; content
  enters at scale 0.95 + opacity + 2pt blur; reduced motion is a 0.12s opacity
  crossfade, never a snap. Onboarding: `PrimaryButtonStyle` (scale 0.97 in 120ms,
  ink plate / paper label, no hue), per-step ticks with a spinner while active, and a
  keyboard-initiated (Return) or reduced-motion advance moves without animation —
  progress dots included.
- **N7 · App login item.** `enableTrackAtLogin` registers `SMAppService.mainApp` in
  the same approved Start that installs the LaunchAgent; `disableTrackAtLogin` and
  `signOut` unregister it; the onboarding step's `.onAppear` registration is gone.
  The tracker LaunchAgent stays exactly FC1 (`RunAtLoad`,
  `KeepAlive { SuccessfulExit: false }`, `ThrottleInterval 30`, explicit `HOME`).

### FC4 — tokenless entrances and stdin login

`Handoff.swift` carries `{ apiUrl?, webUrl? }` only; `vibehub://connect` ignores a
`token` query item; `VibeHubApp.init` adopts servers and fires no `connect`. The one
remaining token path is `TrackerProcess.run(… stdin:)` → `login --token-stdin`.

**Verified read-only on 2026-09-21: `tracker/src/index.ts` still declares only
`login <deviceToken>`; `--token-stdin` is not landed.** That file is Cody's, not this
lane's, and was not edited. Handled here without weakening the contract: there is no
argv fallback; `indicatesMissingStdinLogin` maps commander's usage error (`unknown
option '--token-stdin'` / `missing required argument 'deviceToken'`) to a message
naming the cause; and CI gained a **Verify embedded tracker contract** step that fails
a bundle whose embedded CJS lacks `--token-stdin` or the hidden `serve` command, plus a
source-level print/NSLog guard. Until the flag lands, CI is expected to go red at that
step — deliberately, after the Swift build has already reported.

### Checkpoint §M.5 — nullable counts

`TrackerMe.Today.tokens` is `Int?`. `Format.optionalCount` renders nil as the same
em-dash ≈$ uses; `Format.tokensLabel` puts B7's exact words — "tokens not reported" —
under the stat in the popover and the expanded Island; the pill, which has no labels,
uses the dash with an accessibility label. Never 0, never an estimate. `estimatedUsd`
handling is unchanged (already nullable).

### Lumi — five UX points, assets, Dark Mode

1. First start: the real mark. `BrandMark.swift` is a CoreGraphics port of
   `assets/branding/vibehub-mark.svg` (48-unit viewBox, three radius-16 arcs stroked
   at 5, 6.5 core, 4.3 satellite — arcs sampled at 2° so no API's notion of
   "clockwise" is involved). It replaces the SF chevron in the welcome step, the
   token field, the Island pill's loading glyph, the menu-bar glyph
   (`BrandMarkImage.menuBar`, a template `NSImage`) and the app icon
   (`scripts/make-icon.swift`, same numbers). Done-tick is `.secondary`; a spinner sits
   beside the button while Start is in flight.
2. Settings: one "Start with my Mac" switch owning both halves; an in-flight spinner;
   errors as a symbol + medium weight in `.primary` — the earlier `.orange` broke
   strict monochrome and is gone.
3. Menu: daemon liveness is a neutral filled/hollow glyph; presence keeps the only hue.
4. Collapsed Island: a distinct glyph per state (mark / add-account badge / struck
   antenna).
5. Expanded Island: `needsToken` is its own terminal state with an action, no longer
   the loading branch; the skeleton is shape-matched to header + Now.
- Artwork: `background.png`/`@2x` (Lumi) used as delivered. New
  `background-dark.png`/`@2x`: the paper mark (`vibehub-mark-1024-paper.png`)
  auto-cropped and resampled to the same content size and offset as Lumi's tiles —
  50×50 at (39,39) on 128 px, 100×99 at (78,78) on 256 px — RGBA, transparent tile, no
  new style. `make-pkg.sh` emits `<background-darkAqua>` only for these files and no
  longer points Dark Mode at the ink mark; the python3 dependency is gone (`sed '$d'`
  + append, with an assertion that the descriptor ends with its closing tag). DPI
  chunks were not set on the new tiles (the image tool writes none); Installer does
  not select `@2x` from DPI.

### Generic tool labels

`Format.toolNames` mirrors `TOOL_NAMES` in `web/src/lib/format.ts` — `cursor`,
`windsurf`, `zed`, `grok`, "Quadcode AI", "Codex CLI" — ids are kebab-normalised the
way the web does it, and unknown ids title-case. No view hardcodes Claude/Codex; the
stale "Cursor … explicitly unavailable" comment is gone.

### Compile hazards fixed while reading

- `IslandController.deinit` read @MainActor stored properties from a nonisolated
  context — removed (monitors are already removed in `hidePanel`; the object lives for
  the app's lifetime).
- `NotificationCenter.addObserver(forName:…using:)`'s block is `@Sendable`; the call
  into `applyFrame` now hops with `Task { @MainActor in }`.
- `foregroundStyle(cond ? .tertiary : .primary)` has no inferable type — both arms are
  now `AnyShapeStyle`.
- `Components.swift` imports AppKit for `Color(nsColor:)`.

### Deviations, and why

1. **No running-instance guard (the first half of N3).** A `NSRunningApplication`
   de-dup by bundle id also matches the *same* copy being relaunched by `postinstall`
   while the old one quits, and deciding which instance yields needs the real-Mac test
   this lane cannot run. The location guard closes the plist-rewrite hazard N3
   describes; the two-copies case is recorded as open in the plan.
2. **Primary buttons are ink/paper, not `.borderedProminent`.** A press state needs a
   `ButtonStyle`; once one exists, the system-accent tint would be the only hue in a
   monochrome product, so it was not reproduced.
3. **The menu-bar glyph is now the mark.** Not one of Lumi's five points; done so one
   figure appears on every surface. `Image(nsImage:)` in a `MenuBarExtra` label is the
   documented route and is as unverified as everything else here.
4. **CI is expected to fail** at "Verify embedded tracker contract" until the tracker
   lane lands `--token-stdin`. The Swift compile result still arrives first, from the
   earlier build step.

### Changed files (this round only)

New: `Sources/VibeHub/BrandMark.swift`, `pkg/resources/background-dark.png`,
`pkg/resources/background-dark@2x.png`.
Edited: `Sources/VibeHub/{TrackerManager,TrackerMe,Format,IslandController,IslandView,
PopoverView,SettingsView,OnboardingView,OnboardingWizard,Components,VibeHubApp}.swift`,
`scripts/make-icon.swift`, `scripts/make-pkg.sh`, `pkg/Distribution.xml`,
`pkg/resources/{welcome,conclusion}.html`, `README.md`, `.github/workflows/mac.yml`,
this file.
Re-read, not edited: `AppSettings.swift`, `Handoff.swift`, `LaunchAgent.swift`,
`Keychain.swift`, `APIClient.swift`, `StatusStore.swift`,
`OnboardingWindowController.swift`, `Package.swift`, `Resources/Info.plist`,
`scripts/bundle.sh`, `scripts/embed-tracker.sh`, `pkg/scripts/postinstall`, `.gitignore`,
Lumi's `background.png`/`@2x`.

### Verification actually performed

Brace and paren balance on every Swift file including the icon script (all even);
grep for the removed symbols (`compactCount(me.today.tokens)`, `.orange`, the SF
chevron, `borderedProminent`, python3) — only comments remain; the CI print/NSLog
regex against `Sources/VibeHub/` — no match; `bash -n` on all four scripts — pass; no
tabs in `mac.yml`; `make-pkg.sh`'s Distribution edit simulated with both artwork
elements and the result parsed as XML; read-only grep of `tracker/src` for
`token-stdin` — absent. **Not** performed: any compile, `swift build`, pkg build,
YAML schema validation (no parser on this box), or run of anything.

## Polish round — first real-Mac pass (2026-09-25)

MacBook Air M2 (Mac14,2), macOS 26, Swift 6.3.3 Command Line Tools, no Xcode. Nothing
committed, installed or started; the installed 1.1.0's LaunchAgent plist was checked
byte-identical (md5) before and after, and `com.vibehub.menubar` defaults unchanged.

**Build.** `swift build` cannot run here: the CLT's `swift-package` (6.3) and its
`usr/lib/swift/pm/*.framework` (a later release) disagree, so SwiftPM dies in dyld
before reading the package. Fixing that needs a CLT reinstall (sudo), out of lane.
The sources compile with **zero errors and zero warnings** via `swiftc`, once pointed at
an SDK its compiler can read (`xcrun` picks a 27.0 beta SDK built by Swift 6.4). New
`scripts/swiftc-build.sh` + `scripts/select-sdk.sh`; `bundle.sh` falls back to them only
when `swift build --version` fails, and calls its helpers through `bash` (they are
committed 644; CI chmods them). `bundle.sh` → universal app, Node pin verified, signature
valid; `make-pkg.sh` → `dist/VibeHub.pkg` 1.1.0 + `.sha256`.

**QA harness (DEBUG only).** `AppEntry` (new `@main`) hands `--snapshot <dir>` and
`--qa-island <state> [--expanded|--qa-cycle]` to `QAHarness` before `VibeHubApp` exists.
Fixture hooks, all `#if DEBUG`: `Keychain.fixtureToken`, `StatusStore(fixture:now:)`,
`TrackerManager(fixtureRunning:…)` (every mutating call refuses), `AppSettings(defaults:)`
(the one non-DEBUG change: injectable, `.standard` by default). Release binary checked
free of harness strings. Shots: `.temp/qa/mac/{before,after}` (35 each), live
`screencapture -x` in `.temp/qa/mac/live`.

**Island — bugs found in the before shots, fixed.**
- Collapsed pill was only as tall as its text: a 13pt black band floating mid menu bar.
- Loading/needsToken/failed glyph was centred — i.e. under the camera, invisible.
- Every poll re-published `phase`, `showPanel()` reset `isExpanded`: an open island
  collapsed itself every 15s.
- A click inside the open island toggled it shut under its own buttons.
- 92% black let the hardware notch show through; the expanded header sat under the
  notch; the 260pt card clipped its footer.

**Island — new.** `IslandMetrics` (measured notch: 179×32 here) shared by window and
view; `IslandShape` with 6pt concave shoulders, 10pt lower corners matching the notch,
easing to 24 as it opens; pure black. Content only in two 90pt wings; the band stays put
and swaps to name/presence when open, the body is uncovered beneath it. The **window
frame** is driven by `FrameSpring` (response/damping like SwiftUI's spring) at 120Hz:
measured live, open 32→287pt (7pt overshoot of 280) settling in ~0.5s, close in ~0.3s
with none. Reduced motion: frame jumps, content crossfades.

**Popover / Settings / onboarding / pkg — copy cut.** Popover: no tracker row or
"Start tracking" before sign-in; FC2's caveat is a tooltip, not a paragraph. Settings:
Account / General / This Mac, switches right-aligned, `defaults write` hints moved to the
README. Onboarding: one centred layout per step, one title + one line; the token step
lost its triple heading; progress ticks appear only once running. `OnboardingView` is
controls only (hosts title it). pkg welcome/conclusion rewritten to the pairing flow
(the conclusion still said "mint a token and paste it"), transparent + Dark Mode.

**Could not verify.** Hover and click on the real panel (synthetic mouse events are
blocked without Accessibility permission — verified via `--qa-cycle` instead); the
popover and Settings live (the final build is parked on a Keychain prompt: ad-hoc
signatures differ per build, and the synchronous launch-time token read blocks the UI
until it is answered); notchless and multi-display placement; the pkg install itself.

**Follow-up (same day).** Popover actions cut to three — Open VibeHub, Settings, Quit.
"Go online" opened the web connect sheet, which on a Mac whose app *is* the connector
read like a presence switch (Start already lives in the tracker row); the island had
already swapped it for Settings. "Copy tracker token" moved to Settings → Account, next
to Sign Out. Popover labels now match the island: "≈ spend", "N friends online".
Rebuilt with `bundle.sh` + `make-pkg.sh`; release binary checked for the new strings and
free of harness paths.

**Installer (found while installing this build).** `make-pkg.sh` marks the app bundle
non-relocatable: Installer could otherwise "upgrade" any other copy with this bundle id (a
dev build, an unzipped zip) and leave `/Applications` alone. `pkg/Distribution.xml` declares
`hostArchitectures="arm64,x86_64"`, so the postinstall runs natively, not under Rosetta (a
Mac without Rosetta was asked to install it first). The postinstall's `vibehub-tracker` shim
was never written: the user side sat in root's 0700 TMPDIR (`Permission denied`) and trusted
`$HOME` under `sudo -u`. It now gets the script as an argument, the shim on stdin and the
dscl home as `$1`. The pkg's summary page shows the PATH line for zsh and bash again.

**Tracker: the app's LaunchAgent is no longer "an older install".** `vibehub-tracker autostart
status`, run through the app's shim, byte-compared the app's plist (written by
PropertyListSerialization: sorted keys, tabs, no marker) with the CLI's template, called it
"an older install", and suggested `autostart enable`. `start` and `autostart enable` would
then rewrite it and bounce the job. Now the app's plist that names this install counts as
current, the status line says the app manages it, `start` leaves it alone, and
`autostart enable` no longer rewrites it. A stale plist the CLI wrote itself is still refreshed.
