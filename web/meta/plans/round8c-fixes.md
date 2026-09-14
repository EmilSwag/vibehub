---
SECTION_ID: plans.round8c-fixes
TYPE: plan
STATUS: completed
PRIORITY: medium
---

# Round 8C fixes — reinstall context, per-user celebration gate

Web only. No commit, no deploy. `npm run build` green at the end.
Design law: `skills/emil_design_eng/SKILL.md` + `docs/DESIGN.md`. Skills consulted:
`emil_design_eng` — the only VibeHub-relevant template on the MCP server; both fixes are
copy and state, so nothing else applied.

## 1. "Already installed on …" — the offline reinstall line  [skill: emil_design_eng]

Opening the sheet while offline on a machine that already has the tracker currently
reads as a first-time install. One line fixes that, and it is the one line that stops
someone reinstalling when opening their editor would have done it.

- [ ] Condition: presence is **offline** *and* `status.devices` is non-empty. Empty
      devices changes nothing — a genuinely new account still sees exactly what it saw.
- [ ] Copy, one line: *"Already installed on {device} — last ping {relative}. Opening
      your editor usually brings it back — or reinstall below."*
- [ ] `{device}` is the **most recently used** device's label (the one that pinged last),
      falling back to the first when the server dated none. `{relative}` is `agoShort`,
      the same "12s ago / 3d ago" grain the strip and panel already print.
- [ ] **No box** — muted text on the sheet's own ground, `--vh-text-faint`, above the
      picker. Placed as the first thing in the sheet body, so it reads as context
      *before* "Pick how you work" rather than wedging itself between that title and the
      control it belongs to.
- [ ] **Token minting untouched.** The sheet still mints exactly as it does now; this is
      a sentence, not a branch.

## 2. Per-user celebration gate  [skill: emil_design_eng]

`vh-connect-celebrated` is a bare sessionStorage key, so signing out and into a second
account in the same tab silently swallows that account's "All connected." moment.

- [ ] Key becomes `vh-connect-celebrated:<userId>`.
- [ ] The read-and-claim moves into `lib/connectToken.ts` as `claimConnectCelebration`,
      next to the other per-user session flags — **both** ConnectTools and ConnectSheet
      call it, so the two gates cannot drift apart. Their local `CELEBRATED_KEY`
      constants go.
- [ ] Private mode (storage throws) keeps today's behaviour: celebrate once rather than
      never.
- [ ] No user id yet (auth still loading) means no claim; the effect re-runs when it
      arrives, so the moment is delayed rather than lost.

## 3. Verify

- [ ] `npm run build` green; the three contract checks still pass.

## Progress log

- 2026-09-07 — plan written.
- 2026-09-07 — both landed. `npm run build` green (153 modules); brandMark 120, format
  121, recentModels 20. No `CELEBRATED_KEY` left anywhere. Not re-run in a browser: fix 1
  is one muted line and fix 2 is a storage key, and the harness that would exercise them
  was deleted at the end of part C.
