**Build: green** — `npm run build` re-run just now, exit 0 (153 modules); checks brandMark 120 / format 121 / recentModels 20.

**Files** — `connect/ConnectSheet.tsx` + `.module.css` (offline reinstall line), `ConnectTools.tsx` and `lib/connectToken.ts` (per-user celebration gate). Plan: `web/meta/plans/round8c-fixes.md`.

**Verify 1** — open the sheet while offline with at least one device: one faint unboxed line above "Pick how you work", naming the most-recently-used device and its last ping. An account with no devices sees no line and nothing else changes.

**Verify 2** — connect, see "All connected.", sign out, sign into a second account in the same tab and connect: it celebrates too. Reconnecting the first account in that tab does not celebrate twice.

**Skipped** — no browser re-run; the part-C harness was deleted and neither change alters rendering enough to rebuild it. Fix 1 was verified by reading the condition, fix 2 by confirming no `CELEBRATED_KEY` survives anywhere.

**Edge cases taken as calls** — the line sits above the step title rather than between title and picker; a device with no dated ping reads "no ping yet"; private mode still celebrates once rather than never.
