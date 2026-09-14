**Build status: green.** Re-run just now — `npm run build` exit 0: EOL fix → `tsc -b` → `vite build` (153 modules transformed) → EOL check.

---

Plan: `web/meta/plans/round8c-followups.md`. Build green (153 modules); checks brandMark 120 / format 121 / recentModels 20.

**Files** — new `lib/connectDeepLink.ts`; edited `main.tsx`, `HomePage.tsx`, `lib/useTrackerPing.ts`, `connect/ConnectSheet.tsx`, `__checks__/brandMark.check.ts`.

**Verify** — hit `/?connect=1` on Home: sheet opens, `connect` gone from the URL, works in every tracker phase. Already-tracking: all four steps rest done, step one reads "Already set up on this machine", no celebration, no auto-close. Mid-wait it still celebrates and closes as before. Reload Home: sheet stays shut (flag is read-once). Logged out: `/?connect=1` → login → GitHub → lands on Home with the sheet open. Telegram: pinned by assertion — `LINK_MARKS.telegram` is the simple-icons Telegram path, not the globe.

**Skipped** — no browser re-run (part C's pass covered the sheet; nothing in its rendering changed). Login/claim code untouched, so signing in **in a different tab** loses the flag and lands on Home with the sheet closed. Private mode drops it too; the param is still stripped. `useTrackerPing` still has no contract check.
