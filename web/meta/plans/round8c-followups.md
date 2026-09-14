---
SECTION_ID: plans.round8c-followups
TYPE: plan
STATUS: completed
PRIORITY: medium
---

# Round 8C follow-ups — connect deep link, Telegram mark

Web only, on top of part C. No commit, no deploy. `npm run build` green at the end.
Design law unchanged: `skills/emil_design_eng/SKILL.md` + `docs/DESIGN.md`.
Skills consulted: `emil_design_eng` (the only VibeHub-relevant template on the MCP
server). Nothing covers deep-link capture, so step 1.1 is a custom approach.

## 1. `/?connect=1` — the menu-bar app's "Go online"  [skill: emil_design_eng]

### 1.1 Capture before the router can rewrite it

- [ ] `src/lib/connectDeepLink.ts`: `captureConnectDeepLink()` reads `?connect=1` from
      `window.location.search`, records it in `sessionStorage`, and strips the param
      with `history.replaceState`. `takeConnectDeepLink()` reads-and-clears it once.
- [ ] Called from `main.tsx` **before render** — the param has to be read before the
      router mounts and before `ProtectedRoute` bounces a logged-out visitor, and it has
      to be stripped whether or not anyone is signed in.

### 1.2 Open the sheet on Home

- [ ] `HomePage` takes the flag on mount and opens its own `ConnectSheet` — Home already
      mounts `ConnectTools`, but that component skips the sheet in its loading and
      dismissed-strip branches, and "whatever the tracker phase" means the deep link
      cannot depend on which branch won.

### 1.3 Already tracking: the step list rests at "Tracking works"

- [ ] `useTrackerPing` records whether presence was already `active` on the first status
      after open, and treats that as started — so the sheet arrives with all four steps
      done rather than an idle, empty step 2.
- [ ] `ConnectSheet` must **not** celebrate or self-close in that case. The close-on-live
      behaviour is for the *transition* into live; an account that was already live has
      nothing to congratulate and the person asked to see this sheet.

### 1.4 Logged out

- [ ] The flag lives in `sessionStorage`, so it survives `ProtectedRoute`'s bounce to
      `/login`, the GitHub round-trip and the `?oauth=` claim — all same tab, same
      origin — and LoginPage already lands on `/` afterwards. No change to the login or
      claim code. If the person signs in **in a different tab**, the flag does not follow
      and they land on Home with the sheet closed.

## 2. Telegram  [skill: emil_design_eng]

- [ ] Confirm `LinkIcon` renders the real Telegram mark for the server's new `telegram`
      icon key, and pin it in `brandMark.check.ts` so a future regeneration cannot
      quietly drop it back to the website globe. No other change.

## 3. Verify

- [ ] `npm run build` green; the three contract checks still pass.

## Progress log

- 2026-09-07 — plan written.
- 2026-09-07 — both landed. `npm run build` green (153 modules); brandMark 120 (3 new
  link-icon pins), format 121, recentModels 20. Telegram confirmed by assertion rather
  than by eye: `LINK_MARKS.telegram` is the simple-icons Telegram path and is not the
  globe. Not re-run in a browser — the sheet itself was driven at the end of part C and
  nothing in its rendering changed here.
