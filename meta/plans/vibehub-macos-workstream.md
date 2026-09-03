---
SECTION_ID: plans.vibehub_macos_workstream
TYPE: plan
STATUS: in_progress
PRIORITY: high
---

# VibeHub macOS Workstream

GOAL: Implement Workstream 4 (macOS menu-bar app) per docs/BUILD_PLAN.md §7 — read the
tracker's local `~/.vibehub/status.json`, render live status in the menu bar, "Open
Dashboard" + "Quit". Work confined to `macos/`; server/web/tracker/docs are frozen
contracts for this workstream and are not touched.
SCOPE: `vibehub/macos` only (SwiftPM executable target `VibeHubMenuBar`, AppKit).
TEMPLATE CHECK: Queried QCAI `ToolGetTemplates` for `type="developer"` (no such type)
and `type="skills: quadcode.ai"` — only IDE meta/config/UI-panel skills and
gamedev/product/media-generation skills exist; none apply to native Swift/AppKit
engineering. No QCAI template used; hand-written Swift against the BUILD_PLAN/
ARCHITECTURE contracts instead. Claude Code skill aliases are tagged per step below
where one genuinely applies.
CONSTRAINT: No Swift toolchain in this (Windows) session — code is written to spec but
not locally compiled; the build/run step is documented as blocked pending macOS
hardware.

## Task Checklist

### Design decisions
- [x] Confirm status.json path/schema against ARCHITECTURE.md §4.4 [skill: none]
- [x] Poll vs. file-watch: **5s poll timer**, not `DispatchSourceFileSystemObject`. The
      tracker's atomic write (temp file + `rename()`, BUILD_PLAN §6 item 4) swaps the
      inode on every update; a `DispatchSource` fd-watch on the old inode stops firing
      after the first rename, so a naive file-watch silently goes stale. Polling
      sidesteps that. Documented in `macos/README.md`. [skill: none]

### Implementation
- [x] `StatusSnapshot.swift` — Codable wire model for status.json + `TrackerStatus`
      enum (active/idle/offline/unavailable) + elapsed-time formatter ("1h 42m" style)
      + tool-name humanizer (`claude-code` → "Claude Code") [skill: none]
- [x] `StatusFileWatcher.swift` — reads+decodes `~/.vibehub/status.json` on launch and
      every 5s via `Timer`; missing file / malformed JSON → `.unavailable`, rendered
      identically to offline; never writes the file [skill: none]
- [x] `main.swift` — wire `StatusFileWatcher` into `AppDelegate`; update
      `statusItem.button.title` and the disabled status-line menu item on every tick;
      keep existing "Open Dashboard"/"Quit" items [skill: none]
- [x] `WEB_APP_URL` → build-time default overridable via `UserDefaults`/
      `defaults write VibeHubMenuBar WebAppURL "..."` per BUILD_PLAN §3 (was a bare
      hardcoded `let`) [skill: none]
- [ ] Launch-at-login (`SMAppService`) toggle — [skipped: BUILD_PLAN §7 explicitly
      marks this "Optional follow-up (not MVP)"]

### Docs & verification
- [x] Update `macos/README.md`: document the poll-vs-watch decision and the
      `defaults write` override, per BUILD_PLAN §2.3/§3 [skill: none]
- [ ] Build/run verification — **blocked**: no Swift toolchain on this machine;
      [skill: run] once on macOS hardware (`swift build && swift run`, then
      edit `~/.vibehub/status.json` by hand to exercise active/idle/offline/
      missing-file paths)
- [x] Self-review of the diff for scope creep / contract drift before calling this done
      [skill: code-review] — reviewed `StatusSnapshot.swift`/`StatusFileWatcher.swift`/
      `main.swift`/`README.md` inline; removed one unused stored property found during
      review; no edits outside `macos/` and `meta/plans/`.

## Success Criteria
- [ ] Builds with `swift build` on macOS 13+ (unverified here — no toolchain)
- [ ] Menu bar reflects `status.json` within 5s of a change, across
      active/idle/offline/missing-file states, matching ARCHITECTURE.md §4.4 exactly
- [ ] Zero edits outside `macos/`
- [ ] `WEB_APP_URL` remains overridable at runtime without a rebuild
