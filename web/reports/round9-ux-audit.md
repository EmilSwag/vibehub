# Round 9 · 2.2 — UX/UI audit and fixes

Date: 2026-09-14. Plan: `meta/plans/vibehub-round9-text-diet-ux-audit.md` step 2.2 + 3.
Skill: `emil_design_eng` (the only frontend skill `ToolGetTemplates` returns) — its §1
simplify, §2 native feel, §4 motion, §5 loading/empty states and §6 onboarding rules are
what every entry below is measured against.

**Scope:** `web/src` only. No commit, no deploy, no `git checkout --`, no real tracker
(heartbeats came from `.temp/qa/round9-fixture.js` on throwaway `vh-qa-*` accounts).

## Harness

| | |
|---|---|
| Static | `.temp/qa/round9-static.js` → `http://localhost:8911`, serves `web/dist` with SPA fallback |
| API | `.temp/qa/round9-proxy.js` on **:4000** → prod API. `QA_FAIL_MINT=1` makes token minting 500 so the sheet's mint-failure branch is reachable in a browser (off by default). The shipped bundle is built with `VITE_API_URL=http://localhost:4000` (`web/.env`), so the proxy has to answer there; `:8910` also runs for curl. Patched this round to accept the `qa_user` cookie as well as `x-qa-user` / `?qa=`, still allow-listed to `^vh-qa-[a-z0-9-]+$` with a session file on disk. |
| Viewports | `dist/__r9frame.html` (local only, deleted after) frames the app in a fixed-width iframe so 1440×900 and 390×810 are real CSS viewports, not a zoomed window |
| Accounts | `vh-qa-prof-jace` (8 model rows, 5 projects, 2 friends, 3 wall posts), `-trio`, `-solo`, `-nil` (all empty states), `vh-qa-r9-onb` (onboarding) |

Every screen was walked at **1440 and 390, light and dark**: Home (waiting / connected /
offline / idle), Friends, Profile (self, friend, non-friend, empty), Project page (repo and
plain), Projects, Settings, Onboarding steps 1–4, ConnectSheet (all five tool tabs, both
OSes, Details open), Celebration, Login.

---

## Fixes — screen → was → now

### Friends

1. **Handle + role line was crushed to a few pixels.** `.rowText` had `min-width: 0` but no
   `flex`, so the column was only as wide as the display name — and `.rowMeta`'s
   `max-width: calc(100% - 96px)` then resolved against *that*, not the row.
   *Was:* `@vh-q…`, `@…`, and one row rendering the single character `(`; measured
   `clientWidth` 5–49px against a 145px `scrollWidth`.
   *Now:* `.rowText { flex: 1 1 auto }` and `.rowMeta { max-width: 100% }` — full text
   (`@vh-qa-prof-nil · Founder`) with a real ellipsis when it genuinely does not fit.
   `web/src/pages/FriendsPage.module.css`

2. **Adjacent cards had different gutters.** `.card { padding: 0 }` + `.row { padding: 10px 6px }`
   put request/finder rows 7px from the card edge while the `FriendListItem` rows beside them
   sat at 17px, and the search input was flush against the card border (1px inset).
   *Was:* avatar insets 7 / 17 / 7px across the three cards; search input inset 1px.
   *Now:* `.card { padding: 8px }` + `.row { padding: 10px 8px }` (`.listCard` keeps 0 so its
   rows still bleed); avatar inset **17px in all three**, search input inset 9px.

3. **Accept sat under Decline on phones.** `@media (max-width: 720px) { .rowActions { flex-direction: column } }`
   stacked the two buttons, doubling the row height and putting the destructive action on top.
   *Was:* Decline above Accept at 390.
   *Now:* media query keeps the row (two `sm` buttons are 142px together and fit beside an
   ellipsized name), gap tightened to 4px.

4. **`Unfriend` was a 16px-tall tap target.**
   *Now:* `padding: 8px 4px; margin: -8px -4px` — 32px hit area, identical line box.

5. **Three filled black `Invite` pills competed with nothing.** A repeated row action carried
   the same weight as a screen's primary.
   *Was:* `variant={sent ? "secondary" : "primary"}`.
   *Now:* `variant={sent ? "ghost" : "secondary"}` — quiet outline, "Sent" quieter still.
   `web/src/pages/FriendsPage.tsx`

### Home (tracker panel)

6. **The Models list was a page-long wall.** `status.sources.map()` was uncapped; the jace
   fixture rendered **16 rows** (32 lines at 390) inside the first card on the page.
   *Was:* 16 rows, panel 782px tall at 1440, taller than the viewport at 390.
   *Now:* `HOME_SOURCE_ROWS = 5` on the `home` variant with a quiet `11 more` / `Show fewer`
   toggle. Settings keeps the full list — it is the full explainer.
   `web/src/components/TrackingStatus.tsx`, `TrackingStatus.module.css` (`.more`)

7. **`Revoke` on the Home banner.** A destructive device action sat in a first-run explainer.
   *Was:* `<DeviceList … onRevoke={onRevoke} />` in both variants.
   *Now:* `onRevoke={variant === "settings" ? onRevoke : undefined}` — Home lists devices
   read-only so a second machine is still visible; revoking lives with the tracker controls.

8. **Two buttons fighting over the footer.** `Go online` (filled) and `Got it` (outline) sat
   side by side, with `Got it` rightmost — the position that reads as primary — and the
   `@media (max-width: 480px) { .actions { flex-direction: column-reverse } }` then put
   `Got it` *above* `Go online` on a phone.
   *Was, at 390:* Got it → Go online → Tracker settings, top to bottom.
   *Now:* `Got it` drops to `ghost` and moves before `Go online` in the DOM, so the one filled
   button is rightmost on desktop and topmost on mobile. Measured at 390: Go online (y 500) →
   Got it (554) → Tracker settings (608).

9. **Skeleton → content jumped 438px.** The busy panel drew a head, two lines and 2 model
   rows; the real panel adds 5 model rows, devices and a footer. This is the first block on
   Home, so everything under it moved.
   *Was:* skeleton 344px → panel 782px (`docH` 1020 → 1359).
   *Now:* the skeleton mirrors the panel's scaffold (head, Today, Now ×2 lines, Models ×5,
   Devices ×2, footer with privacy line + action pill): **683px → 782px, a 99px jump**.

### Profile

10. **The wall composer was shown to people who cannot post.** `server/src/routes/wall.ts`
    rejects non-friends with 403, but the composer rendered for any signed-in viewer.
    *Was:* `{me && <Card className={styles.composer}>…}` — typing and pressing Post on a
    stranger's wall returned "Only friends can write on this wall".
    *Now:* `canPost = Boolean(me) && (isSelf || presences.has(username))`. `presences` is
    seeded from `/presence/friends`, which is self + accepted friends and nobody else — the
    same rule the server enforces. Verified: hidden on `/u/vh-qa-prof-nil`, shown on
    `/u/vh-qa-prof-trio` and on own profile. `web/src/pages/ProfilePage.tsx`

11. **Two primaries above the fold.** `Go online` was a filled ink pill two lines above
    `Edit profile`, the screen's actual primary.
    *Now:* `variant="secondary"` on `Go online`.

### Project cards (profile, Projects, anywhere `ProjectCard` renders)

12. **A long repo path ate its own icon and never ellipsized.** `.link` is a flex container
    with `overflow: hidden; text-overflow: ellipsis` — but `text-overflow` cannot reach the
    anonymous text item next to the `<svg>`, and the `<svg>` had no `flex: none`.
    *Was:* icon measured `width: 0`, label clipped mid-word at the card edge
    (`clientWidth` 201 vs `scrollWidth` 357, no ellipsis).
    *Now:* `.link > svg { flex: none }` and the label wrapped in `.linkLabel` (`min-width: 0;
    overflow: hidden; text-overflow: ellipsis`). Icon 14px, label ellipsized:
    `vh-qa-prof-jace/very-long-repo…`. `ProjectCard.tsx` + `ProjectCard.module.css`

### Onboarding

13. **Step 1's `Continue` hung 90px past its input.** `.field` caps at 340px and is centred;
    `.actions` is the stage's full 520px and right-aligned.
    *Was:* field right edge 890, button right edge **980**.
    *Now:* `.actionsField` (max-width 340, centred by `.step`'s `align-items: center`) on the
    identity step only — both right edges land on **890**. Steps 2–4 already matched their
    controls and are untouched.

14. **Every step sat at the top of a 100vh screen.** 230–400px of dead space under each one.
    *Now:* `.stage { justify-content: center; padding-bottom: 40px }` — the step is centred in
    whatever height is left.

15. **`Back` and `Skip` huddled together on the connect step.** With no filled button on that
    step, `justify-content: flex-end` pushed both text links into one ambiguous pair at the
    right edge, 12px apart.
    *Now:* `.actions > .linkButton:first-child { margin-right: auto }` — Back anchors left on
    every step.

16. **Six filled `Invite` pills out-shouted the one button that advances the flow.**
    *Now:* same change as Friends — `secondary` un-invited, `ghost` once invited, leaving
    `Skip for now` / `Continue` as the single primary. `StepFriends.tsx`

### Connect sheet

17. **Both scroll areas cut their content flush against an edge with no cue.** The agent
    prompt has `max-height: 200px` over ~693px of content, and opening `Details` overflows the
    sheet body. Chrome's overlay scrollbar paints nothing at rest, so the prompt ended
    mid-instruction (`- Windows (PowerShell):`) and read as a rendering bug.
    *Tried first:* `scrollbar-width: thin` + `::-webkit-scrollbar` — measured `offsetWidth -
    clientWidth = 0`, i.e. still an overlay scrollbar, still invisible. Reverted.
    *Now:* scroll shadows on `.text` and `.body` — two cover gradients on
    `background-attachment: local` over two fixed radial shadows, so the shade appears only
    while there is content past that edge and clears when you reach it. Covers are opaque for
    the shadow's full height (`… 0 14px, transparent 22px`), or the resting state keeps a
    ghost of the shadow it is meant to hide. Black alpha only — no hue. Verified light and
    dark. `ConnectSheet.module.css`

### Connect sheet — "3 · Connecting" and the stalled help

Forced into the harness after the first pass: open the sheet, press Copy (which sets
`started`, the flag the whole block hangs off — the clipboard write itself is refused in
an embedded browser, which is how the failure states below got exercised too), then wait
out `STALLED_AFTER_MS` (90s) on the wall clock. Seen at 1440 light and 390 dark.

23. **The copy error rendered ~400px from the button it was about.** `{error && <p>}` was
    the last child of the sheet body — under step 2, under the whole progress list, and
    under the stalled help once that opened — while the message says "select the command
    **above**" with two commands above it.
    *Was:* Copy at y 344, "Copy failed — select the command above." at y 796 (measured);
    the sheet had to be scrolled to find it.
    *Now:* `error` carries which control it belongs to (`{ what, message }`), rendered
    directly under that Copy button with `role="alert"`. Verified both slots: failing the
    install copy puts it at y 376 under the step-1 button; failing the start copy moves
    the single message to y 613 under the step-2 button.
    **And the mint-failure branch:** `error.what === "install"` renders *outside* the
    `text ? … : …` ternary on purpose — a failed mint is exactly the case where `text` is
    null, so an error placed in the truthy branch would be the one error nobody ever
    sees. Verified by forcing the token endpoint to 500 (`QA_FAIL_MINT=1` on the proxy):
    "Token mint refused" renders under step 1's skeletons.
    `web/src/components/connect/ConnectSheet.tsx`

24. **Pressing Copy created the answer off-screen.** Copy is at the top of the sheet and
    "3 · Connecting" is appended at the bottom of a scrolling body, so the feedback for
    the press landed below the fold — the block was cut at its third row and I had to
    scroll by hand to read it, twice.
    *Now:* an effect scrolls the block into the body's view the first time it appears,
    `block: "end"` (the newest row is the one worth seeing) after two
    `requestAnimationFrame`s — one frame is not enough, the block mounts its rows and the
    sweep line in the same commit and a scroll measured before that settles lands 36px
    short (measured: `scrollTop` 31 of 67, block bottom 848 vs body bottom 836).
    *Verified:* `scrollTop` 59, block 681→820 inside a body ending at 836, `fullyVisible`.
    `behavior: "smooth"` unless `prefers-reduced-motion`.

25. **The indeterminate progress line read as a divider.** `.pline` sat at the active
    row's `bottom: 0`, spanning `left: 26px` to the row's right edge, animating
    `scaleX(0 → 1 → 0)`. At the top of its sweep it is a full-width 1px rule sitting
    exactly where a list divider would be, between "Waiting for first ping…" and
    "Connected" — which is how it reads at 390.
    *Now:* the element is a transparent `overflow: hidden` track and its `::after` is a
    33%-wide dash translating across it and fading at both ends. Sampled live: a fixed
    162px segment moving from -145px to +486px across a 492px track — it is never full
    width, so it cannot be mistaken for a rule. Still 1px, monochrome, transform +
    opacity only. `ConnectSheet.module.css`

### Celebration

18. **14 model chips over six ragged centred rows.** The skill calls for "summary chips", not
    an inventory.
    *Now:* `MODEL_CHIPS = 6` plus a `+8 more` chip — three tidy rows.
    `web/src/components/ui/ConnectCelebration.tsx`

### Global

19. **The focus ring was invisible on every filled button, in both themes.**
    `.btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--vh-focus-ring) }` draws
    `rgba(0,0,0,.35)` on the edge of a `#111` button in light and `rgba(255,255,255,.35)` on
    `#F2F2F2` in dark — no offset, so it composites onto the button itself and disappears.
    *Now:* `outline: 2px solid var(--vh-focus-ring); outline-offset: 2px` — the same treatment
    `tokens.css` gives everything else, sitting on the surface behind the control. Applied to
    `Button.btn`, `ThemeToggle.btn`, `TopBar.avatarButton`, and the three `.segBtn` sets
    (Settings, ConnectTools, ConnectSheet — those use `outline-offset: -2px` so the ring is
    not clipped by the segmented track).

20. **The brand link was a 20×20 tap target on phones.** `@media (max-width: 640px)` hides
    `.logoText`, leaving only the 20px mark.
    *Now:* `min-height/min-width: 40px` with a compensating negative margin, so the mark stays
    on the content gutter. `TopBar.module.css`

21. **Sub-32px touch targets.** `ProfilePage .linkChip` already had a `@media (pointer: coarse)`
    lift; three siblings did not.
    *Now:* the same pattern for `RecentModels .toggle` ("View all N models", was 17px),
    `ProjectCard .likeBtn` (was 23px) and `ProjectsPage .iconBtn` (edit/delete, was 30px).

22. **`ProjectsPage.module.css` declared `.header`, `.grid` and `.empty` twice.** The first
    copy of every duplicated property was dead — editing the top of the file changed nothing.
    Merged into the surviving blocks with values unchanged; computed styles before and after
    are identical (grid `3 × 334.6px`, gap 24px, `align-items: start`; header
    flex/space-between/flex-start/16px/0). The ragged card heights are deliberate — these are
    posts of different lengths, not a table — and now say so in a comment.

---

## Checked and deliberately left alone

| | |
|---|---|
| `StatTile` wells inside the Stats card | Not card-in-card: `StatTile.module.css` documents them as tinted wells with no border, which is the house rule's own escape hatch. |
| Projects grid's ragged bottom edge | `align-items: start` is intentional for a feed of differently-sized posts. |
| `sm` buttons at 30px (Accept/Decline/Invite/Revoke) | A deliberate size token for dense rows, not a regression. |
| Coloured avatars and README emoji on the project page | Remote user content, not UI chrome; the monochrome rule governs what the app paints. |
| `~` on Home/celebration but not on the profile's Tokens tile | Different numbers: `sumToday().estimated` vs a server aggregate that is not an estimate. |
| Visitor profile has no "Add friend" action | Real gap, but it is a feature (request wiring), not a polish fix. Logged here, not built. |

## Motion / reduced motion

No motion was added that does not respect the preference, and nothing new animates a layout
property — the two new visual elements (the `.more` toggle and the scroll shadows) animate
nothing. Confirmed in the shipped bundle `index-*.css`: the global override is present
(`--dur-*: 0ms` plus `*,*:before,*:after{animation-duration:.001ms!important;
animation-iteration-count:1!important;transition-duration:.001ms!important}`), along with 12
component-level `prefers-reduced-motion` blocks; `index-*.js` carries 4 `matchMedia(
"(prefers-reduced-motion: reduce)")` guards (Lottie, `lib/motion.ts`, Confetti, celebration).
The one infinite animation, `vh-live-pulse`, is capped to a single iteration by the global rule.

## Not exercised in the harness

The **`pinged` stage** ("First ping", with the device and tool that sent it) is the one row
state not seen: driving a real heartbeat into a waiting sheet takes it from `waiting`
straight to `live` in under one 3s poll, because the same heartbeat that makes the ping
fresh also makes presence active. The transition itself was verified end to end — sheet
waiting → heartbeat → sheet closes and Home flips to Connected — and the row uses the same
`.pstep` markup as the two states that were seen.

## Gate

`node .temp/qa/run-final-web-checks.js` → **exit 0**

```
build          exit 0   ✓ built in 1.5s · [eol] LF-only confirmed in 2 shipped file(s)
models         exit 0    30 passed, 0 failed
marks          exit 0   120 passed, 0 failed
format         exit 0   121 passed, 0 failed
connectPrompt  exit 0    60 passed, 0 failed
trackerPing    exit 0    62 passed, 0 failed
installers     exit 0   PASS — 183 passed, 0 failed, 0 blocker(s)
```

`npx tsc -b --force` exit 0. `git diff --numstat -- web/src` shows text diffs only, no
binary rows. No commit, no push, no deploy.

Re-run after the connect-sheet fixes (findings 23–25): same result, exit 0.

## Files touched in 2.2

```
web/src/components/TrackingStatus.tsx               models cap, read-only devices, footer order, skeleton
web/src/components/TrackingStatus.module.css        .more
web/src/components/ProjectCard.tsx                  .linkLabel span
web/src/components/ProjectCard.module.css           svg flex:none, .linkLabel, coarse .likeBtn
web/src/components/RecentModels.module.css          coarse .toggle
web/src/components/connect/ConnectSheet.tsx         error placement, progress scroll-into-view
web/src/components/connect/ConnectSheet.module.css  scroll shadows, segBtn ring, sweep dash
web/src/components/ui/Button.module.css             focus ring
web/src/components/ui/ThemeToggle.module.css        focus ring
web/src/components/ui/ConnectCelebration.tsx        chip cap
web/src/components/layout/TopBar.module.css         focus ring, mobile logo target
web/src/pages/FriendsPage.tsx                       invite weight
web/src/pages/FriendsPage.module.css                rowText/rowMeta, gutters, mobile actions, unfriend
web/src/pages/ProfilePage.tsx                       canPost, Go online weight
web/src/pages/ProjectsPage.module.css               duplicate selectors merged, coarse .iconBtn
web/src/pages/SettingsPage.module.css               focus ring
web/src/pages/onboarding/Onboarding.module.css      stage centring, Back left, .actionsField
web/src/pages/onboarding/StepIdentity.tsx           .actionsField
web/src/pages/onboarding/StepFriends.tsx            invite weight
```
