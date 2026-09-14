# Round 10 U1 — "Tracker is running with an old token"

Web-only. Plan: `meta/plans/vibehub-round10-web-stale-tracker.md`.

## The problem

A daemon on the PO's machine heartbeats a token the server revoked hours ago. Every
heartbeat is a 401, so presence never goes active and the site says **Offline** — the same
word it uses for a laptop that is simply shut. Offline is not wrong, it is useless: it
sends the person to start a tracker that is already running.

The server now distinguishes the two cases. `GET /users/me/tracker` carries:

```ts
staleTracker: { lastRejectedAt: string; label: string | null; revokedAt: string } | null
```

non-null when a **revoked** token of this account hit the heartbeat endpoint in the last
10 minutes. It is typed **optional** on the web side: an older server omits the key, and
that must behave exactly like `null`.

## Copy, identical on all three surfaces

> **Tracker is running with an old token.** Redo step 1 and step 2. Start replaces it.

Muted helper scale (13px, `--vh-text-faint`, lead one shade up at `--vh-text-dim`),
monochrome, no icon, no button — every surface it appears on already has the button. Both
sentences live as exported constants in `lib/trackerPing.ts` and are rendered by exactly
one component, so no surface can drift.

## What changed, per surface

**Home — YOU strip (`TrackingStrip`).** The hint takes a row of its own under the strip,
i.e. under *Go online*, aligned with the title (22px = 10px dot + 12px gap). `.strip`
gained `flex-wrap: wrap` + `row-gap` to allow that row. The line above is unchanged:
`.stripMain` shrinks to nothing before anything wraps, so dot + main + right still share
one line exactly as they did under `nowrap`. The only new behaviour is that a right column
too wide for its container now drops to its own line instead of overflowing.

**Settings — tracker panel (`TrackingStatus`, `variant="settings"`).** The hint sits inside
the head block, directly under the status word and its "last ping … · every 30s" line, at
the same left edge. Measured gap 29px. The panel is shared with Home's first-run explainer
(`variant="home"`), which gets the hint too — same question, same answer, and only one of
the two is ever on screen.

**Connect sheet — waiting state (`Progress`).** The hint **replaces** the neutral waiting
copy rather than sitting beside it: row 1 of the step list reads "Tracker is running with
an old token." in place of "Waiting for first ping…", keeping its elapsed timer. The fix
sentence renders under the step list, aligned with the step labels (26px). "Waiting for
first ping…" next to "your tracker is failing to ping" reads as two unrelated facts, and
the neutral one is the one that sounds like progress.

Steps 1 and 2 are untouched: nothing is hidden, disabled or covered, and both Copy buttons
stay enabled. The sentence tells the reader to run them again, so it must not be in their
way.

## The freshness rule (sheet only)

The sheet speaks only while `staleTracker.lastRejectedAt` is **strictly newer** than the
moment this attempt reached the waiting stage:

```ts
staleSinceWaiting(hint, waitingSince)
  = hint !== null && waitingSince !== null && Date.parse(hint.lastRejectedAt) > waitingSince
```

`waitingSince` is new output from `useTrackerPing` (the existing `startedAt`, previously
internal). The sheet is read as a report on the command just run: a rejection from hours
ago is a true fact about the account and a misleading one here, because it would tell
someone who just pasted a fresh token that their tracker is running with an old one.

Home and Settings are ambient and have no "moment this attempt began", so they use the
plain rule (`!connected && staleTracker`) with no timing gate.

Known limitation, deliberate: `lastRejectedAt` is a server clock and `waitingSince` a
browser clock. Skew can make the sheet quieter or noisier by the size of the skew; it can
never make it wrong about which case it is. Asking the server for its clock buys accuracy
nothing here needs.

## Files changed

| File | ± |
|---|---|
| `src/types/index.ts` | +21 / −0 |
| `src/lib/api.ts` | +2 / −0 |
| `src/lib/trackerPing.ts` | +61 / −0 |
| `src/lib/useTrackerPing.ts` | +7 / −0 |
| `src/lib/__checks__/trackerPing.check.ts` | +73 / −1 |
| `src/components/TrackingStatus.tsx` | +11 / −0 |
| `src/components/TrackingStatus.module.css` | +27 / −0 |
| `src/components/connect/ConnectSheet.tsx` | +24 / −2 |
| `src/components/connect/ConnectSheet.module.css` | +12 / −0 |
| `src/components/ui/StaleTrackerHint.tsx` | new, 31 |
| `src/components/ui/StaleTrackerHint.module.css` | new, 23 |
| `scripts/run-checks.mjs` | new, 80 |
| `scripts/qa-stub-api.mjs` | new, 189 (QA only, not shipped) |
| `package.json` | +1 / −0 (`test:checks`) |

Out of scope and untouched: `public/tracker/*`, `tracker/`, `server/`.

## Checks added

16 new pins in `src/lib/__checks__/trackerPing.check.ts`:

- **Type present** — compile-time, not runtime. The check files are inside
  `web/tsconfig.json`'s `include`, so `tsc -b` fails if the field is dropped, stops being
  optional, or changes shape. Verified by negative control: removing `staleTracker`
  (TS2339/TS2353), making it required (TS2741) and renaming `lastRejectedAt`
  (TS2345/TS2322) each fail the build; the file was restored by hash with a clean
  typecheck after.
- **Hint when `!connected && staleTracker`** — lead and fix both returned.
- **Hidden when connected** — including while some *other* token of the account is being
  rejected.
- **Hidden when `staleTracker` is null**, and when the key is **omitted entirely**.
- **Sheet freshness rule** — newer, older, equal (not newer), no waiting moment, no hint,
  and an unparseable server timestamp.

Also added `scripts/run-checks.mjs` + `npm run test:checks`: the five `*.check.ts` files
were five commands with five totals and no single answer to "is the web side green?".

## Gate

| | Before | After |
|---|---|---|
| `npm run test:checks` | 398 passed / 0 failed (5 files) | **414 passed / 0 failed** (5 files) |
| `trackerPing.check.ts` | 62 | **78** |
| `npm run build --workspace web` | green, 154 modules | **green, 156 modules** |

Bundle: `dist/assets/index-tbZPm-2B.js`, 349.67 kB (gzip 114.99 kB).
CSS: `dist/assets/index-lyD7eJhZ.css`, 102.53 kB (gzip 17.68 kB).
Before the round: `index-DovMzCNi.js` (348.54 kB) / `index-BIoP12NT.css` (102.13 kB).

(Rebuilt after the 390px fix below; the previous hashes were `index-f2fXUsP9.js` /
`index-D_NvOqhh.css`. Check totals are unchanged by that fix — it is CSS only.)

## Verified in the harness

`scripts/qa-stub-api.mjs` serves just enough API to render Home, Settings and the sheet,
with `staleTracker` switchable at runtime (`GET /__qa/scenario`). No real server, no real
tracker, no revoked-token setup; the account is a fiction named `vh-qa-stub`. Driven with
`vite --host 127.0.0.1` and `VITE_API_URL` pointed at the stub.

| scenario | Home strip | Settings panel | sheet (waiting) |
|---|---|---|---|
| offline + `staleTracker` | hint | hint | hint replaces neutral copy |
| connected + `staleTracker` | absent | absent | n/a (not waiting) |
| offline + `staleTracker: null` | absent | absent | neutral |
| offline, key omitted (older server) | absent | absent | neutral |

Freshness driven live: `rejectedAt=-2h` → "Waiting for first ping… 00:02", no hint.
`rejectedAt=+30s` → "Tracker is running with an old token. 00:08" in its place. Steps 1
and 2 reachable and both Copy buttons enabled in every state. No console errors after the
stub was corrected.

**One real defect found and fixed.** The two sentences were separated by a CSS margin, so
the text layer ran them together — `old token.Run step 1` — for screen readers and
copy-paste. It looked correct in every screenshot, which is why the DOM check caught it
and the eye did not. Now a real space in the markup; the margin is gone.

Two harness bugs, recorded because each first looked like a product bug: a missing
`GET /users/:username` route crashed Settings' links section (it destructures `links`
unguarded), and a `lastSeenAt` computed per request crept forward every poll, so the sheet
declared "First ping" with no tracker anywhere. The stub now pins every timestamp at boot
except `lastRejectedAt`, and logs any unstubbed path instead of silently answering `{}`.

Also worth knowing: the dev server binds IPv6-only by default, so `127.0.0.1:<port>`
silently reached a different project's dev server on the same port. `--host 127.0.0.1` is
required.

## 390px and light theme

Both run in the same harness. The browser tool cannot resize its window (`wanted_size` is
ignored for tabs, and `resizeTo` does not stick), so the app was loaded into a same-origin
`<iframe>` sized 390×844 — media queries evaluate against the iframe viewport, confirmed:
`innerWidth 390`, `(max-width: 640px)` and `(max-width: 480px)` both matching. Light theme
via `localStorage["vh-theme"] = "light"`.

| surface | 390 dark | 390 light | desktop light |
|---|---|---|---|
| Home strip | hint on its own row under *Go online*, 2 lines, no overflow | same | hint on its own row, 1 line |
| Settings panel | hint under the status word, same left edge, 2 lines | same | verified earlier (dark) |
| Sheet (waiting) | hint replaces neutral copy; fix line inside the dialog | same | verified earlier (dark) |

Page horizontal overflow: **0** everywhere after the fix below. Hint colours are
`rgb(85,85,85)` and `rgb(138,138,138)` in light — greyscale confirmed programmatically
(`r === g === b`), so no hue leak in either theme.

### Defect found at 390px — pre-existing, fixed

The Home strip overflowed its card by 39px and pushed the page into 23px of horizontal
scroll. Cause: in the `max-width: 640px` block `.stripRight` takes `flex-basis: 100%` plus
a 22px indent, but the flex container defaulted to `flex-wrap: nowrap`, so its three
children — token counter, *Go online*, *Tracker settings* — could not wrap and ran off the
right edge.

**Not a regression from this round.** Verified by switching the stub to `staleTracker:
null` so no hint renders at all: the overflow was identical (39px card / 23px page). It
predates the round-10 work. Fixed anyway, since the pass surfaced it: `flex-wrap: wrap` +
`row-gap: 8px` on `.stripRight` in that block. After: 0 card overflow, 0 page overflow, and
the hint still sits on its own row below *Go online*.

### Contrast, measured and deliberately not changed

In light theme the fix sentence is `--vh-text-faint` (#8A8A8A) on white — **3.45:1**,
below WCAG AA 4.5:1 for 13px text. The lead is `--vh-text-dim` (#555) at **7.46:1**.

Left as is on purpose. `--vh-text-faint` is the product's meta-text token, and the
directly comparable instructions in this very component use it at the same size: `.note`
(the status/stop commands) and `.installedDetail` ("Run step 2 again. After a reinstall…")
are both 12.5px `--vh-text-faint`. Promoting only this one sentence would make it
inconsistent with its immediate neighbours to work around a system-wide characteristic.
The token is a design-system decision for the PO, not a fix to smuggle in here — but the
number is recorded so it is a decision rather than an oversight.

## Not verified

- **No real `staleTracker` from the real server.** Every run used the stub. The response
  *shape* is the contract; if the server emits different field names or a different
  freshness window, nothing here would catch it.
- **No reduced-motion or screen-reader pass.** The hint is static text with no motion, and
  the missing-space defect was found by DOM inspection, not by assistive tech.
- **Desktop light theme covers the Home strip only.** Settings and the sheet were checked
  in light at 390 and in dark at desktop, not in light at desktop; the hint has no
  width-dependent styling in either, so the untested corner is the theme × width product,
  not a distinct code path.
- **Not deployed, not committed.**
