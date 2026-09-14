---
SECTION_ID: plans.round8c-connect-sheet
TYPE: plan
STATUS: completed
PRIORITY: high
---

# Round 8 part C — "Go online" and the connect sheet (web only)

On top of A (brand marks) and B (Models block), which are deploying now. Everything
lands under `vibehub/web/`. No deploy, no git commit. `npm run build` green at the end.

Design law: `skills/emil_design_eng/SKILL.md` (read in full) + `docs/DESIGN.md` — strict
monochrome, `--vh-*` only, zero hue except `--vh-live`; 120ms press / 200ms state /
320ms enter; `opacity` and `transform` only; `prefers-reduced-motion` honoured.
Skills consulted: `emil_design_eng` (`tools: developer / frontend`) — the only
VibeHub-relevant template on the MCP server. Nothing covers modal/focus-trap mechanics,
so that part is a custom approach.

## PO ask (verbatim)

> "Connecting my profile should read like: it's not working right now — status Offline —
> to go online click HERE. I click, and I get the instructions: via terminal, or via
> Cursor / Codex / Quadcode AI. And the moment I've pasted it, I see progress — like
> 'pinging your system…'"

---

## Step 1 — every self offline surface gets a real action  [skill: emil_design_eng]

The four surfaces, self only. A visitor never sees any of this, and **idle stays
informational — no button**: idle means the tracker is talking, so there is nothing to
go and do.

- [ ] **Home `TrackingStrip`** (offline) — "Go online" beside the existing "Tracker
      settings" link.
- [ ] **`TrackingStatus` panel footer** (offline) — same action, as the footer's primary.
- [ ] **`ProfilePage` presence hero**, self only — the one surface with no tracker
      component on it today; it renders its own sheet.
- [ ] **Settings `#tracker`** — `ConnectTools variant="full"` already lives there; the
      action arrives with the ConnectTools edit below.
- [ ] **`ConnectTools`' waiting phase** (never connected) — its primary becomes
      **Connect**, opening the same sheet. Its inline picker, prompt disclosure and
      manual-install block move *into* the sheet: one component, two entry points, no
      duplicated token or copy logic.

Wording: **say ping, never heartbeat.** `TrackingStatus` and `TrackingStrip` currently
print "last heartbeat 12s ago" / "no heartbeat yet". Those two strings change with this
pass — leaving "heartbeat" next to the new "pinging" copy would read as two products.

## Step 2 — `ConnectSheet`  [skill: emil_design_eng]

`src/components/connect/ConnectSheet.tsx` + `.module.css`. One component, every entry
point.

- [ ] Bottom sheet on mobile, centered dialog max 560px on desktop.
- [ ] `role="dialog"`, `aria-modal="true"`, labelled by its title. Focus moves in on
      open and returns to the opener on close. Focus trap on Tab/Shift-Tab. Escape
      closes. Backdrop click closes. Body scroll locked while open.
- [ ] The existing connect card reworked as **steps**, not a wall of text.
- [ ] Title "Go online".

### 2.1 Step 1 "Pick how you work"

- [ ] Segmented picker: **Terminal | Cursor | Codex | Quadcode AI | Claude Code**,
      reusing `ConnectTools`' `Segment` (lifted into the sheet, same markup and roles).
- [ ] Token minting is `ensureConnectToken` unchanged — it already dedupes in-flight
      calls and stores per user, so two entry points cannot mint twice.
- [ ] `connectPrompt.ts` gains `codex` and `quadcode` targets. Both are agentic and take
      the existing "run it yourself" branch; only `chatgpt` needs the walk-through one,
      and `chatgpt` leaves the picker (it is not in the PO's five).
- [ ] **Terminal** shows the one-line install (`buildInstallCommand`, OS auto-detected,
      OS still switchable); the four agent tabs show the paste-to-agent prompt.
- [ ] **One primary Copy button.** No second copy affordance competing with it.
- [ ] **Max two lines** of plain-language explanation per tab, e.g.
      "Paste this into Cursor's chat — it installs the tracker on your machine and
      starts it".

### 2.2 Step 2 "Pinging your machine"

- [ ] Starts automatically the moment Copy is pressed, or on open when a token already
      exists.
- [ ] Vertical live progress, four steps:
      **Copied** → **Waiting for the tracker to start on your machine** (elapsed mm:ss)
      → **First ping received** (device name, tool) → **Tracking works**.
- [ ] Under the active step, a **thin 1px monochrome indeterminate line**. No spinners.
- [ ] Elapsed timer ticks once a second, `tabular-nums`, fixed width, no layout shift.
- [ ] After **90s** with nothing: a quiet **"Still waiting — check that the command
      finished. Common fixes"** disclosure — node missing, token pasted twice, terminal
      closed. Text only, `--vh-text-faint`, **never an error colour**.

### 2.3 `useTrackerPing`  [skill: emil_design_eng]

`src/lib/useTrackerPing.ts` — small, and the only thing that knows what "a ping" is.

- [ ] Polls `usersApi.trackerStatus()` every **3s while the sheet is open**, and only
      while `document.visibilityState === "visible"` (listens for `visibilitychange`).
- [ ] Also merges the realtime presence push for the viewer (`useRealtime().presences`)
      when available, so a fast tracker beats the next poll.
- [ ] **Baselines `lastSeenAt` at open.** "First ping" is a *newer* `lastSeenAt` than the
      baseline, not merely a non-null one — otherwise an offline account that pinged
      yesterday would jump straight to step 3 with stale data.
- [ ] "Tracking works" is `presence.status === "active"`, matching `trackerTitle`, so the
      sheet and the panel behind it never disagree.
- [ ] Reports `{ stage, elapsedMs, device, tool, stalled }`; owns no UI.

### 2.4 Done

- [ ] The existing celebration modal (**"All connected."**) fires **once** — gated by the
      same `vh-connect-celebrated` session key `ConnectTools` already uses, so whichever
      surface completes shows it and the other does not repeat it.
- [ ] Sheet closes. Strip and panel flip live on their own next poll/push.
- [ ] The "Got it" flow is unchanged.

## Step 3 — copy and motion  [skill: emil_design_eng]

- [ ] Sentence case, short, no marketing. Titles exactly: "Go online", "Pick how you
      work", "Pinging your machine", "Tracking works".
- [ ] Steps advance with a **160ms** fade/slide; reduced-motion safe (motion.css already
      zeroes durations globally, and the indeterminate line stops animating).
- [ ] Idle stays informational, no button.

## Step 4 — verify

- [ ] `npm run build` green: EOL fix → `tsc -b` → `vite build` → EOL check.
- [ ] Existing contract checks still pass (`format`, `recentModels`, `brandMark`).
- [ ] Driven in a browser on an isolated port against a stubbed tracker status, so the
      four progress stages, the 90s disclosure, Escape, the focus trap and the
      reduced-motion path are all exercised rather than reasoned about.

## Footprint

New: `components/connect/ConnectSheet.tsx`, `ConnectSheet.module.css`,
`lib/useTrackerPing.ts`.
Edited, minimally: `lib/connectPrompt.ts` (two targets), `TrackingStatus.tsx`,
`ConnectTools.tsx`, `ProfilePage.tsx`, `SettingsPage.tsx`.

## Progress log

- 2026-09-07 — plan written after reading ConnectTools, TrackingStatus, connectPrompt,
  connectToken and the four surfaces.
- 2026-09-07 — all four steps landed. `npm run build` green (152 modules); brandMark 117,
  format 121, recentModels 20 all passing. Driven in a browser against a stubbed tracker:
  dialog semantics, focus trap both ways, Escape, scroll lock, focus restore, all four
  progress stages, the stalled disclosure and the celebration.
- **SettingsPage needed no edit** — it already renders `ConnectTools variant="full"`,
  which now owns the sheet. The plan expected a change there; there wasn't one.
- Found while testing: a refused clipboard write left the wait un-started, so the person
  most in need of progress saw none. The wait now starts either way, and step one says
  "Command ready — copy it from above" instead of claiming "Copied".
