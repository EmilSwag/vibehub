# Tracker setup — explicit background-start consent (Jace row)

Date: 2026-09-14 · Plan: `meta/plans/vibehub-tracker-explicit-start.md`
Scope: the **Jace** row only — prompt + connect sheet under `vibehub/web/src`, plus an agreed
minimal `ConnectTools` edit and one overflow fix.
Design rules: `skills/emil_design_eng/SKILL.md`, `vibehub/docs/DESIGN.md`.
QCAI `ToolGetTemplates` exposes exactly one applicable skill, `emil_design_eng`; it governed the
sheet copy and states. No other template matched.

**Authority honoured:** code changed only under `vibehub/web/src`; no commit, push or tag; no
deploy; `web/public/tracker/install.*`, `web/scripts/*` and `web/package.json` are Cody's and were
not touched. No real tracker was launched on this workstation. No token pasted in chat was used or
recorded.

---

## 1. What was wrong

`src/lib/connectPrompt.ts` is the single source for the install one-liner and the agent prompts;
`ConnectSheet` and `ConnectTools` both consume it. Two things fed the refusal the PO reported:

1. **Install and start were one action.** Both installers ended with `node "$BIN" start`, and the
   prompt said *"Run the matching command yourself"*. One paste = download + save token + spawn a
   persistent background daemon, with no separate consent. The sheet said it out loud — every
   `EXPLAIN` string ended *"and starts it"*.
2. **The prompt gave an agent no denial path.** It said "confirm it worked… don't guess", and
   nothing about what to do when the agent's own safety layer refuses. That vacuum is where a
   capable model improvises a bypass.

Two further defects found while working, both in files this row owns:

3. **`STATUS_CMD` was one hardcoded POSIX path** (`node ~/.vibehub/app/vibehub-tracker.cjs status`)
   emitted into the **Windows/PowerShell** branch too. `node` never expands `~`, so the verify line
   was unrunnable on Windows.
4. **A stored token faked progress.** `setStarted(readStoredConnectToken(userId) !== null)` meant a
   token minted on an earlier visit made the sheet show *"Waiting for the tracker to start"* to
   someone who had done nothing this session — a claim it then had to keep for 90 seconds.

---

## 2. The contract now implemented

**Prompt — installs/configures only, then asks and waits.** Six steps: detect OS → run install
(*"It starts no process and adds no login item"*) → report what it printed → **stop, explain, ask,
wait** → start only on an explicit yes → verify. `BACKGROUND_START_MEANS` is the single consent
sentence, used verbatim in both the prompt and the sheet, so the same consent is never described
two different ways.

The closing clause is the point of the change:

> If your own safety rules or approval prompts block the start, stop automating right there. Show me
> the matching line and tell me to run it in my own terminal … Do not look for another way to run it,
> do not retry it with different flags, a different shell or a wrapper script, and do not edit any
> permission, allow-list or settings file. **A blocked start is a normal outcome, not a problem to
> solve.**

That last sentence is load-bearing: without it a refusal reads as an obstacle, and an obstacle is
the kind of thing a capable model routes around.

**Token containment by construction.** `login` is deliberately absent from the `TrackerVerb` union,
so `buildTrackerCommand(os, verb)` — and therefore start/status/stop — cannot carry a token. The
install one-liner is the only command that does.

**Sheet — 1 · Install / 2 · Start tracking / 3 · Connecting.** One OS picker now governs the whole
sheet (it always chooses step 2's commands, not only Terminal's one-liner). Step 2 shows the
token-free `start` with its own Copy and quotes `status` / `stop` beneath. **"Agent blocked it? Use
Terminal"** sits in step 1 from the moment the sheet opens — one click switches the picker — rather
than appearing after a failure the sheet has no way to detect.

**Honest progress.** A stored token no longer sets `started`. The already-live deep link still
rests correctly, because that path runs on `liveAtOpen`, which `useTrackerPing` reads from presence
rather than from local state. Step 1's label now names the command that was copied ("Install command
copied" / "Start command copied") instead of implying it ran, and a refused clipboard falls back to
"Command ready — copy it from above". Everything past step 1 remains server-confirmed only.

**Stalled help re-ordered.** *"Step 2 hasn't been run yet — installing sets the tracker up, it
doesn't start it"* is now first, because after Cody's installer change it is the likeliest cause;
second is the agent still waiting on the user's answer, or having declined.

**`ConnectTools` (Settings → Tracker), agreed minimal edit.** It renders `buildInstallCommand` under
"Run in your terminal" and would otherwise have become a dead end: install succeeds, nothing ever
tracks. Added the token-free start command with its own Copy and one line of copy. Nothing else in
that component changed.

---

## 3. The drift check found a real defect — in my own code

The `start` / `status` / `stop` strings now exist in two places that cannot share a source: the
installers print them from shell/PowerShell variables, `connectPrompt.ts` emits them in TypeScript.
Each side is pinned by its own suite, so both can be green while disagreeing with each other. Rather
than leave that to sign-off, it was run immediately — and it had already drifted:

| | |
|---|---|
| Installer prints | `node "$HOME/.vibehub/app/vibehub-tracker.cjs" start` |
| Web was emitting | `node ~/.vibehub/app/vibehub-tracker.cjs start` |

Beyond the mismatch this was a genuine bug on the web side: an unquoted `~/…` word-splits on a home
directory containing a space, and quoting the tilde (`"~/…"`) would stop it expanding at all, so
`"$HOME/…"` is the only form that is both expanded and safe. Both OSes now emit the installer's
quoted form, pinned with a comment naming the installer variables they mirror (`APP_DIR`,
`Join-Path $HOME`).

The clean build re-confirmed it against the built artifact: `dist/tracker/install.sh` carries
`BIN="$HOME/.vibehub/app/vibehub-tracker.cjs"`, which renders exactly what `buildStartCommand("mac")`
now emits.

---

## 4. The 9px horizontal overflow at 390

Flagged in the previous pass as pre-existing and outside the row; fixed on request.

**Diagnosis.** `.rowTool` is misnamed — `SourceRow` passes it `modelRowLabel`, so it carries the
**model** name, while `.rowModel` carries the tool name. It was `white-space: nowrap` with
`min-width: auto`, and a flex item's automatic minimum size is its max-content width, so it pinned
at **312px inside a 308px row** and could not shrink at all. `.rowModel` beside it collapsed to 0
(it already had the right properties), leaving the 12px `ToolGlyph` hanging 9px past the viewport
and scrolling the whole page sideways.

**Fix.** The same three properties `.rowModel` has always had: `min-width: 0`, `overflow: hidden`,
`text-overflow: ellipsis`.

**Evidence at 390, before → after:**

| Measure | Before | After |
|---|---|---|
| document `scrollWidth` / `clientWidth` | 399 / 390 | 390 / 390 |
| overflow | 9px | **0** |
| elements past the viewport | 3 | **0** |
| `.rowMain` `scrollWidth` / `clientWidth` | 358 / 308 | 308 / 308 |
| long row's tool name width | 0px (invisible) | **49px** |

It reads better, not merely narrower — the tool name was previously squeezed out of existence.
At 1440: `overflowPx` 0, **0 rows truncate**, and the full 46-character model name still renders, so
the rule only engages when space is genuinely tight.

The trigger was the §F fixture's 46-char model name, which is why it surfaced now.

---

## 5. Files touched

| File | Change | Lines |
|---|---|---|
| `web/src/lib/connectPrompt.ts` | Two-consent prompt; `buildTrackerCommand` + start/status/stop; `buildVerifyLine(os)` replaces `VERIFY_LINE`; `BACKGROUND_START_MEANS`; blocked-start clause | +104 / −15 |
| `web/src/components/connect/ConnectSheet.tsx` | Three numbered steps; hoisted OS picker; token-free step 2; immediate Terminal fallback; honest `Copied` state; stalled help re-ordered | +112 / −38 |
| `web/src/components/connect/ConnectSheet.module.css` | `.inlineCmd` for the quoted status/stop lines | +10 |
| `web/src/components/ConnectTools.tsx` | Start command + Copy in `ManualInstall`; `Copyable` gains `"start"` | +13 / −2 |
| `web/src/components/TrackingStatus.module.css` | `.rowTool` can shrink and ellipsize | +11 |
| `web/src/lib/__checks__/connectPrompt.check.ts` | **New** — 41 safety assertions | 239 |

Also updated: `meta/plans/vibehub-tracker-explicit-start.md` (Jace row closed, drift gate recorded),
and this report.

**Not touched** (Cody's): `web/public/tracker/install.{sh,ps1}`, `web/scripts/test-installers.mjs`,
`web/package.json`. **Not touched** (previous §F work, still green):
`web/src/components/RecentModels.tsx`, `web/src/lib/recentModels.ts`,
`web/src/lib/__checks__/recentModels.check.ts`.

---

## 6. Commands and results

```
npx tsc -b                                             exit 0
rm -rf dist && npm run build                           clean
```

Build output:

```
dist/index.html                        1.36 kB │ gzip:   0.73 kB
dist/assets/index-BGhpdfR9.css       100.03 kB │ gzip:  17.20 kB
dist/assets/lottie_light-BiXcaY9x.js 169.16 kB │ gzip:  48.37 kB
dist/assets/index-BTDZbNWP.js        345.93 kB │ gzip: 114.03 kB
✓ built in 1.92s
[eol] ok — LF-only confirmed in 2 shipped file(s): dist/serve.json, dist/tracker/install.sh
```

Check suites:

| Suite | Result |
|---|---|
| `recentModels.check.ts` | **30 passed, 0 failed** (§F work, unchanged) |
| `brandMark.check.ts` | **120 passed, 0 failed** |
| `format.check.ts` | **121 passed, 0 failed** |
| `connectPrompt.check.ts` *(new)* | **41 passed, 0 failed** |
| **Total** | **312 passed, 0 failed** |

Cody's `web/scripts/test-installers.mjs` reports 82 assertions in the plan; it is his file and was
**not run here**.

What the 41 new assertions pin — safety, not style: no tracker verb carries the token on either OS
(and the install command does, so the test is not vacuous); the token appears exactly twice per
prompt; install → explanation → start ordering for all five targets; the wait-for-an-answer and
"a successful setup is not permission to start" lines; the whole blocked-start clause; a
bypass-vocabulary blacklist (`--dangerously-skip-permissions`, `bypass`, `allowlist`, `auto-approve`,
`settings.local.json`, `sudo`, …) that must match nothing; no bare `~` and a quoted `$HOME` path in
every tracker command; and the three literals that mirror the installers.

---

## 7. Verification — and where it stops

Exercised on the **local-bundle-vs-prod-API harness**: the bundle built locally and served on
`:8911`, talking to the real production API through a local CORS proxy on `:8910` carrying the
`vh-qa-prof-jace` session. **Production data, locally served JS.**

Confirmed there:

- Both sheet steps render; Windows-correct, token-free `start` / `status` / `stop`.
- "Agent blocked it? Use Terminal" switches the picker in one click and hides itself on Terminal.
- The rendered agent prompt orders install → ask → start, carries the blocked clause, and matches no
  bypass vocabulary.
- A stored token in `localStorage` produces **no** progress block and **no** "Waiting" claim.
- A refused clipboard degrades to "Command ready — copy it from above" — observed live, because
  automated clicks have no user gesture.
- Mobile 390: bottom sheet, no internal overflow; desktop 1440: no overflow, no truncation.
- The overflow fix, measured before and after at both widths.

**Nothing above is proven on production.** Deploy and the independent prod retest remain open plan
items.

---

## 8. Honest limits

1. **No fix is on production.** The served JS in every check above was local; only the data was prod.
2. **The Cody/Jace drift gate is one-directional.** The new check goes red if the *web* side of the
   start/status/stop strings changes, but **nothing detects an edit on the installer side** — the two
   suites cannot read each other's files. Re-diff the four printed lines whenever either side moves.
3. **The Copy success path is unverified.** Clipboard writes need a real user gesture, so only the
   *failure* path was exercised (it behaves correctly).
4. **The 90-second stalled disclosure** was verified by reading its strings, not by waiting it out.
5. **Cody's installer suite was not run here** — his files, his 82 assertions.
6. **The external classifier cannot be changed by this work.** The prompt now makes a refusal a
   defined, graceful outcome and hands the user the manual command; it cannot make an agent willing
   to start a background process. Some users will still run step 2 in their own terminal, and that is
   the intended design, not a fallback failure.
7. **Dark mode was the browser's own preference**; light was forced via `data-theme`. The OS-level
   `prefers-color-scheme` switch was not toggled.

---

# Addendum — pre-deploy review fixes (2026-09-14, same day)

A review of the work above found five gaps that had to close before deploy. All five are
implemented; the sections above describe the state *before* this addendum where they
disagree.

## 1 · The consent sentence was factually wrong

`BACKGROUND_START_MEANS` claimed "It reads no file contents". That is false: the Claude
Code, Codex and Quadcode adapters tail session JSONL files. Verified in the tracker
source before rewriting — the adapters' typed interface reads `sessionId`,
`message.id`, `message.model` and `usage.*_tokens` and never touches `message.content`,
so the true statement is about what is *sent*, not what is read.

Now: runs in the background until you stop it · reads activity metadata and window
titles · sends tool, model, project name, timestamps and token counts · never sends
your code or your prompts · adds no OS autostart.

Also: the install step says "starts no background tracker" (was "starts no process"),
and `blockedClause` now covers a blocked **install** as well as a blocked start. The
install branch points back at step 2's command rather than reprinting it, so the token
still appears exactly twice per prompt.

## 2 · The sheet claimed things it could not know

Deleted outright: "Already set up on this machine" and "Opening your editor usually
brings it back". A stored token proves a token was minted once, not that anything was
installed, and this browser cannot infer a physical machine.

- Tracking now: "Your account is already tracking" — about the account, never a machine.
- Offline with a device the server has actually seen: "Last tracked from {device} ·
  {ago}.", with a disclosure carrying the rest.
- Anything else, including device rows with no `lastUsedAt`: silence.

The disclosure says **run step 2 again** — the Start step. An installed-but-offline
tracker needs starting, not reinstalling; that is the whole point of the sentence. It
then notes that if you *do* reinstall, a tracker still running keeps its old settings
until you stop and start it yourself, and that VibeHub never stops, starts or restarts
anything on your machine.

Step 2's own copy now opens "Run this in your own terminal when you're ready", so
nothing implies the browser starts a process.

## 3 · Copy and token state leaked across context changes

`copied` and `error` now reset on a tool, OS, user or open change. A `generation` ref
stamps each clipboard call, so a write that resolves after any of those is discarded
instead of badging a command no longer on screen. Token state is stored with the user
it belongs to and matched at *render* time, so there is no frame in which the previous
account's token is visible.

## 4 · The success rule could fire without a connection

Four real defects, all reproducible from the code:

1. Closing reset the baseline and `liveAtOpen` but kept an active `status`.
2. With the baseline reset to null, the old comparison treated any timestamp as newer —
   so a copy before the first fetch read as live, and the sheet closed and celebrated.
3. Responses from a previous open or user were still accepted.
4. Two effects each fired an immediate refresh, so every open cost two requests.

Rewritten around sessions: one open for one user is a session, every async result is
stamped with it and dropped if it has moved on, and the snapshot is gated on the session
at render time. One effect owns all fetching. The comparison refuses null and
unparseable timestamps. "Live" now requires a fresh ping **and** active presence —
presence alone is exactly what a stale snapshot carries. Already-live at open rests at
"live" and neither closes nor celebrates.

## 5 · The focus trap only caught one edge

The dialog holds initial focus and is not in the focusable list, so it matched neither
boundary and Shift+Tab walked straight out of the sheet. Both edges are now guarded,
and "focus is on the dialog or has escaped" routes to whichever edge the reader is
travelling towards. Escape still closes.

## Lifecycle is now pure and pinned

`web/src/lib/trackerPing.ts` is new and holds the rules as pure functions — `newer`,
`freshPing`, `pingStage`, `shouldCelebrate`, `visibleSnapshot`, `sessionKeyOf` and
`installedNote`. The hook and the sheet both consume them, so the checks pin what
actually ships rather than asserting on prompt strings. `installedNote` takes its `ago`
formatter by injection, which is what lets a DOM-only check exercise it.

## Files touched in this addendum

| File | Change |
|---|---|
| `web/src/lib/connectPrompt.ts` | consent sentence, install wording, blocked-install branch |
| `web/src/lib/useTrackerPing.ts` | session-stamped snapshots, one fetch effect, pure rules |
| `web/src/lib/trackerPing.ts` | **new** — pure lifecycle + `installedNote` |
| `web/src/components/connect/ConnectSheet.tsx` | note rewrite, step 2 copy, copy/token state, focus trap |
| `web/src/components/connect/ConnectSheet.module.css` | note lead/detail styles |
| `web/src/lib/__checks__/connectPrompt.check.ts` | 59 assertions (was 41) |
| `web/src/lib/__checks__/trackerPing.check.ts` | **new** — 48 assertions |

## Results

```
npx tsc -b --force    exit 0
format               121 passed, 0 failed
brandMark            120 passed, 0 failed
recentModels          30 passed, 0 failed   (round-8 section F, untouched)
connectPrompt         59 passed, 0 failed
trackerPing           48 passed, 0 failed
                     378 passed, 0 failed
```

No build in this round — the PO builds combined after both agents. No temporary
servers were left running.

## Limits carried forward

1. **Not verified in a browser this round.** 390 / light / dark / reduced motion were
   checked statically: the new CSS is tokens-only (the single `rgba()` in the file is
   the pre-existing scrim) and the disclosure's `fade-in` is covered by the blanket
   reduced-motion override. The two-line note and the longer step-2 copy have had no
   real narrow-viewport pass. Fold this into the combined build check.
2. **The Cody/Jace drift gate is one-directional.** The checks go red if the web side of
   the start/status/stop strings changes, but nothing detects an edit on the installer
   side — the two suites cannot read each other's files.
3. **The clipboard success path stays unverifiable** under automation, which has no user
   gesture; only the failure path is exercised, and it degrades correctly.
4. **Nothing here is proven on production.** Deploy and the independent prod retest are
   still open plan items.
