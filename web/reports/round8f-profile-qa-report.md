# Round 8 section F — production profile QA, and the three bugs it found

Date: 2026-09-14 · Plan: `meta/plans/vibehub-round8-profile-icons.md` §F
Design rules applied: `skills/emil_design_eng/SKILL.md`, `vibehub/docs/DESIGN.md`.
QCAI `ToolGetTemplates` (`tools: developer` / `frontend`) returned no matching skill — only `vidos`,
an unrelated IDE-video renderer — so the fixes follow `emil_design_eng` and DESIGN.md directly.

**Authority honoured:** code changed only under `vibehub/web`; no commit, push or tag; no server or
auth change; **not deployed** — the PO deploys and retests.

---

## 1. What was proven where

Two different things were exercised, and they are never mixed below:

| Label | What it means |
|---|---|
| **PROD** | The deployed build `index-J4GLHEcd.js` at `https://web-production-da778.up.railway.app`, driven live. |
| **HARNESS** | The fixed build `index-t9KZTgKH.js`, built locally and served on `:8911`, talking to the **real production API** through a local CORS proxy carrying the QA session. Production data, locally served JS. |

Every bug below was **reproduced on PROD first**. Every fix is verified on **HARNESS only** — the
fixed bundle has not been deployed, so no fix is yet proven on production.

---

## 2. Real bugs (all three reproduced on PROD)

### A. The Stats "Top model" tile is dead on a repeat press

The tile is meant to jump to its row in the Models block. Pressed a second time — after the reader
has scrolled away — it does nothing at all.

**Before (PROD).** Profile with 8 models, viewport 1140×820.

1. Press **Top model** ("Claude Sonnet 5") → list expands to 8, row 2 selected, `scrollY 0 → 1`.
2. Scroll to the bottom of the page. Row is now `top: -85` — 85px above the viewport, `scrollY 836`.
3. Press **Top model** again → `scrollY 836 → 836`, row still `top: -85`. Nothing moves.
   Re-read after the smooth-scroll settle window: unchanged.

**Control (PROD), proving the tile itself is not broken.** With a *different* row selected
(Grok 4, `scrollY 883`), the same press scrolls to the tile's row: `scrollY 883 → 751`, row to `top: 0`.
So only the repeat press on an already-selected row is dead.

**Cause.** `ModelFocus.nonce` makes the *parent* effect re-run, but that effect calls
`setSelected(focus.label)` with the label already in state. React bails out of a state update to the
same value, so the `Row`'s `selected` prop never changes, so `useEffect(…, [selected])` — which owns
the `scrollIntoView` — never re-runs. The nonce stopped one level short of the thing it was
protecting.

**Fix.** The selection is now a value that changes on every *request*, not only when the row changes:

```ts
export interface ModelSelection { label: string | null; tick: number; }
export function requestSelection(current, label) { return { label, tick: current.tick + 1 }; }
export function selectionTickFor(selection, label) { … }   // number | null
```

The row takes `selectedAt: number | null` instead of `selected: boolean` and keys its scroll effect
on it. Two presses hand it two different numbers.

The focus effect is also gated on `handledFocus.current === focus.nonce`, so one press is honoured
exactly once — a Retry (which changes `rows`) no longer re-scrolls to a model the reader asked about
minutes ago, and a profile switch cannot re-apply the previous profile's press.

**After (HARNESS).** Viewport 1280×468, row selected and off-screen at `top: 751`:
press → `scrollY 0 → 353`, row to `top: 398`, on screen. `scrollIntoView({block:"nearest"})` fired
exactly once.

### B. Escape-to-collapse drops keyboard focus on `<body>`

**Before (PROD).** Expand to 8 rows, Tab/focus onto **row 6** ("Claude Opus 5 Preview Extended
Thinking Maximum"), press **Escape**. The list collapses to 3, row 6 unmounts, and
`document.activeElement === document.body`. The reader's place is gone; the next Tab restarts from
the top of the document.

**Fix.** `collapse()` measures whether the focused element sits in a row past the preview — the only
rows that unmount — and if so hands focus to the toggle, which is where the list now lives.

**After (HARNESS).** Row 6 + Escape → focus on "View all 8 models", not `<body>`.
Non-regression, same build: Escape with focus on row 1 leaves focus on row 1; on row 3 (the last
surviving row) leaves it on row 3; clicking "Show less" from the toggle leaves it on the toggle.
The rescue fires only when the focused row actually disappears.

### C. Collapsed per-tool details stay in the accessibility tree, and `aria-expanded` has no `aria-controls`

**Before (PROD).** A *collapsed* detail row measured:

```
height: 0px     visibility: visible     aria-hidden: null     inert: false
innerText: "Cursor | 1.1 hrs | 889.0k tokens | last used Sep 14"
```

The detail collapses with `grid-template-rows: 0fr`. That hides it from the eye and from nothing
else — a screen reader reads all eight rows' per-tool breakdowns at all times. Separately, both the
row buttons and the View all / Show less toggle carried `aria-expanded` with `aria-controls` **null**,
so assistive tech could not tell which region the control opens.

**Fix.** One pure function states the contract:

```ts
modelRowAria({ reveals, open, listId, detailId })
// collapsed list → { expanded:false, controls:listId, detailHidden:true  }
// open list, closed row → { expanded:false, controls:detailId, detailHidden:true  }
// open row            → { expanded:true,  controls:detailId, detailHidden:false }
```

The row press names the **list** while the list is collapsed (that is what it opens) and its **own
detail** once the list is open. Closed details are `aria-hidden`. `inert` is deliberately not used:
the detail holds text and never a focusable element, so there is no tab stop to remove, and React
18.3 would warn on a boolean `inert` anyway.

**After (HARNESS).** Across a 9-step sweep: `aria-controls` resolves to the `<ul id>` while collapsed
and to `${blockId}-detail-${i}` once open; `aria-hidden="true"` on every closed detail and absent on
the open one; toggle `aria-controls` matches the list id.

---

## 3. Checked and found correct — no change made

All on **PROD** unless noted.

- **Row ladder.** Collapsed row click → expand + select. Click again → per-tool detail. Again → close.
- **Detail arithmetic.** Claude Opus 5: Claude Code 0.8 hrs / 810.0k + Codex CLI 0.5 hrs / 159.0k,
  against a row total of 1.2 hrs / 969.0k.
- **Tool-chip filter.** `aria-pressed` only on the clicked family; matching rows stay at opacity 1,
  the rest at **0.45** — applied to the inner `.row`, not the `<li>` (an early probe of mine read the
  wrong node and briefly looked like a bug; it is not).
- **Escape ladder.** filter → open detail → selection → collapse, one layer per press, and it stops
  claiming Escape once there is nothing left to undo.
- **Show less** resets all three states at once.
- **Profile link icons.** 7/7 real anchors, correct hrefs, `target="_blank"`, `rel="noreferrer"`,
  16px `currentColor` `aria-hidden` marks beside a visible label — matching DESIGN.md's
  "16 in a link chip" and "a mark is never shown alone".
- **Model counts.** 8 / 3 / 1 / 0 profiles all correct. No "View all" at ≤3 rows, where a row click
  goes straight to its detail. Empty states: self "No models yet." + *Connect a tool* →
  `/settings#tracker`; visitor "No models tracked yet." with no action.
- **Unknown model** → "Frobnicator 9000 Ultra" with the neutral placeholder mark; the tool is never
  dropped. **46-character model name** → single line, `text-overflow: ellipsis`, no wrap, no overflow;
  full text fits at 1440.
- **Error / retry / loading.** Forced stats failure → `role="alert"`, "Could not load models." + Retry;
  Retry recovers the full 8 rows.
- **Overflow.** No horizontal page scroll at 390 or 1440 at any step of the sequence. The 10px
  per-row `scrollWidth` excess is the deliberate `inset: 4px -10px` hit area, absorbed by the card's
  padding (card itself: `scrollWidth === clientWidth`).
- **Light and dark**, 390 and 1440 — monochrome throughout, no hue leak, structure identical.
- **Reduced motion.** JS path proven live: `scrollIntoView` behavior is `auto` when
  `prefers-reduced-motion: reduce` matches and `smooth` when it does not. The CSS path is the blanket
  `*` override in `motion.css` (zeroes `transition-duration` and `animation-duration`) — read in
  source, **not** exercised against a real OS setting. See limits.
- **Profile switching leaves no stale selection.** `ProtectedRoute → PageTransition key={pathname}`
  remounts `ProfilePage` on every profile change, so `modelFocus` resets. Confirmed on PROD:
  focusing "Claude Sonnet 5" on `vh-qa-prof-jace`, then navigating to `vh-qa-prof-solo` — whose only
  row carries that same label — leaves it unselected. The nonce gate added for bug A now also
  protects this case directly rather than by accident of the remount.

---

## 4. Files touched

| File | Change |
|---|---|
| `web/src/lib/recentModels.ts` | `ModelSelection` / `requestSelection` / `selectionTickFor`, `collapseWouldDropFocus`, `modelRowAria` — pure, documented. |
| `web/src/components/RecentModels.tsx` | Selection carries a tick; focus rescue on collapse; `useId` ids, `aria-controls`, `aria-hidden` on closed details; focus effect gated on the nonce. |
| `web/src/lib/__checks__/recentModels.check.ts` | 13 new pins, one group per bug. |

**No CSS changed**, so the layout, theme and overflow results above carry to the fixed build.

Other people's uncommitted work was left byte-identical (md5 taken before and after):
`web/public/serve.json`, `web/public/tracker/install.sh`, `meta/plans/vibehub-finish.md`, and the
untracked `web/meta/`, `web/reports/`, `web/ui_views/`.

---

## 5. Commands and results

```
npx tsc -b                                            exit 0
npm run build                                         ok — index-CE2D6hcq.js, eol check LF-only
npx tsx web/src/lib/__checks__/recentModels.check.ts  30 passed, 0 failed   (17 pre-existing + 13 new)
npx tsx web/src/lib/__checks__/brandMark.check.ts     120 passed, 0 failed
npx tsx web/src/lib/__checks__/format.check.ts        121 passed, 0 failed
```

---

## 6. QA fixtures left in place for the PO's retest

Built through normal endpoints only (`/auth/qa-login`, `PATCH /users/me`, `PUT /users/me/links`,
`POST /users/me/onboarding/complete`, `POST /tracker/heartbeat`). No real user was read or written.

| Username | Models | What it covers |
|---|---|---|
| `vh-qa-prof-jace` | **8** | The main case. Two tools on the top row, an unknown model, a 46-char model name, a tool with no model, an estimated-token row, 7 link chips. |
| `vh-qa-prof-trio` | **3** | Exactly at the preview limit — no "View all", so a row click opens its detail directly. |
| `vh-qa-prof-solo` | **1** | Single row. Shares the label "Claude Sonnet 5" with jace's top model — that is what makes the stale-selection test meaningful. |
| `vh-qa-prof-nil` | **0** | Both empty states. |

Expected row order for `vh-qa-prof-jace` (every bucket shares one UTC day, so the list sorts by hours):
Claude Opus 5 (1.2 hrs, 2 tools) · Claude Sonnet 5 · GPT-5 Codex · Gemini 2.5 Pro (~ estimated) ·
Grok 4 · Claude Opus 5 Preview Extended Thinking Maximum · Frobnicator 9000 Ultra · Cursor.

**Logging back in** — no secret is printed by any of this:

```
node .temp/qa/prod-qa.js login vh-qa-prof-jace
```

It reads `QA_LOGIN_SECRET` from `railway variables --service server --json` itself and writes the
cookie to `.temp/qa/session-vh-qa-prof-jace.txt`. To drive a browser, open the API origin
(`/api/v1/health`), set that cookie string with `path=/; secure; samesite=none`, confirm
`/api/v1/auth/me` names the QA user, then open the web origin — the SPA sends it cross-site.
Full method: `meta/facts/vibehub-prod-qa-session-method.md`.

`.temp/qa/prof-fixture.js` (`build` / `show` / `live`) rebuilds or re-reads the fixtures. It is local
only, hard-locked to `^vh-qa-prof-`, and not in the repo.

**Cleanup, once the retest is done** — the PowerShell form from the same facts file:

```powershell
$b64=[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\scripts\delete-users.js"));
railway ssh --service server -- node -e "eval(Buffer.from('$b64','base64').toString())" `
  vh-qa-prof-jace vh-qa-prof-trio vh-qa-prof-solo vh-qa-prof-nil
```

---

## 7. Honest limits

1. **No fix is proven on production.** Deploying was outside this session's authority. The three
   fixes are verified against a locally built bundle served on `:8911`, proxied to the real prod API.
   The JS differs from what production serves until the PO deploys.
2. **Reduced motion is half-proven.** The JS branch was exercised live by overriding `matchMedia`.
   The CSS branch is the blanket `*` override in `motion.css`, read in source — no real OS
   reduced-motion setting was applied in this browser.
3. **Dark mode was the browser's own preference**, light was forced via `data-theme="light"` +
   `localStorage`. The OS-level `prefers-color-scheme` switch itself was not toggled.
4. **Clicks were dispatched programmatically** (`.click()`, synthetic `keydown`). Real pointer
   hover/active states and true Tab-order traversal were not driven; focus was set with `.focus()`.
5. **Realtime/WebSocket was not exercised** on the local harness — the proxy forwards HTTP only.
   Presence "Currently in use" was therefore checked on PROD data shape, not as a live transition.
6. **The fixtures share one UTC day**, so `lastActiveAt` is identical across rows and the list sorts
   by hours. The recency-first sort path is covered by the unit pins, not by this prod fixture.
7. The 1440 desktop pass used a real 1440-wide window; the first prod sweep ran at 1140×820 (an IDE
   tab, which ignores `wanted_size`). Both were checked; neither showed horizontal overflow.
8. **Two pre-existing observations, deliberately not changed** (out of section-F scope, worth a call):
   the Models capsule is 26px on the first three rows and 16px on the rest, which reads against
   DESIGN.md's "one size per slot"; and the detail animates `grid-template-rows`, a layout property,
   against `emil_design_eng`'s "animate only opacity and transform" — it is smooth and
   reduced-motion-safe, so it was left alone.
