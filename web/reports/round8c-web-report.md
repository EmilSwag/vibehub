Part C is done. `npm run build` green (152 modules), checks at brandMark 117 / format 121 / recentModels 20. Plan at `web/meta/plans/round8c-connect-sheet.md`.

## Files changed

**New** — `components/connect/ConnectSheet.tsx` + `.module.css`, `lib/useTrackerPing.ts`

**Modified** — `lib/connectPrompt.ts` (adds `codex` + `quadcode` targets; both take the existing agentic branch), `lib/connectToken.ts` (`detectOs`/`deviceLabel` lifted out of ConnectTools so both minting callers name a device the same way), `ConnectTools.tsx`, `TrackingStatus.tsx` + `.module.css`, `ProfilePage.tsx` + `.module.css`

**`SettingsPage.tsx` — no edit needed.** It already renders `ConnectTools variant="full"`, which now carries the sheet. The plan expected a change there; there wasn't one.

ConnectTools' never-connected card lost its inline picker, prompt disclosure and manual-install block — its primary is now **Connect**, opening the sheet. That's the deduplication you asked for: one copy of the token/copy logic in the app.

## Interactions to verify

You can drive the whole thing with `__ping`-style script injection — the poll is a plain 3s `GET /users/me/tracker`, so anything that makes that endpoint return a newer `lastSeenAt` advances the sheet.

1. **Offline self surfaces** — Home strip, tracker panel footer, profile presence hero (self only), Settings → all show **Go online**. Set presence to `idle` and confirm the button is *absent* on all four.
2. **Sheet mechanics** — Escape closes, backdrop closes, Tab wraps both ways inside the dialog, body scroll locks, focus returns to the opener. Bottom sheet under 640px, centered ≤560px above.
3. **Step 1** — five tabs; Terminal shows the one-liner plus an OS switch and "Needs Node.js 18+", the four agent tabs show the paste prompt with one explanation line. One Copy button.
4. **Step 2** — starts on Copy, *or* immediately on open if a token already exists from an earlier visit. Watch Copied → Waiting (mm:ss ticking, no reflow) → First ping received (device · tool) → Tracking works. 1px line under the active step only.
5. **Inject a ping** — newer `lastSeenAt` advances to step 3; presence `active` advances to step 4, fires "All connected." once, closes the sheet, and the strip/panel flip live.
6. **Stall** — 90s with nothing shows the quiet "Still waiting… Common fixes" disclosure. Confirm it's faint ink, never an error colour.
7. **Second entry point** — a never-connected account: ConnectTools' **Connect** opens the same sheet, and the token is not re-minted.
8. **Reduced motion** — steps appear instantly and the indeterminate line rests as a static 1px rule.

One bug found while testing: a refused clipboard write left the wait un-started, so the person who most needs progress saw none. The wait now starts either way, and step one reads "Command ready — copy it from above" rather than falsely claiming "Copied".

## Deliberately not done

- **`server/` untouched**, per your call — Telegram still isn't detected, so a Telegram link renders the globe. Passing upstream with you.
- **ChatGPT dropped from the picker** (your five don't include it). Its walk-through branch stays in `connectPrompt.ts` as the only non-agentic variant, unused for now.
- **No live QA against a real profile** — another agent holds :4000 and `dev.db`, so everything above ran against a stubbed tracker on an isolated port. The harness is deleted.
- **No `useTrackerPing` contract check.** It's timing- and DOM-dependent; the three existing check files stay green but none covers it.
- No deploy, no git commit.
