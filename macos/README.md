# VibeHub Menu Bar (macOS)

A thin native companion that shows your current VibeHub tracker status in the macOS
menu bar. It never talks to the server and never needs a device token — it only reads
a local file that `vibehub/tracker` writes.

## Why Swift, not Python + `rumps`

- **Distribution.** An open-source companion app needs to be something people can just
  run: a signed, notarizable `.app` with no runtime dependency, vs. asking every user
  to have a working Python + `pip install rumps`/`pyobjc` setup. `rumps` apps are
  realistically packaged with `py2app`, which is more fragile to notarize than a native
  SwiftPM/Xcode build.
- **Native APIs.** `NSStatusItem`, launch-at-login (`SMAppService`), and sandboxing are
  first-class in Swift/AppKit; bolted-on in `rumps`.
- **The job is small.** Poll/watch one local JSON file, render text in a status item,
  one "Open Dashboard" action — Swift's one-time setup cost is worth it for the
  distribution win, given the app's job never grows much beyond that.
- `rumps` would have been faster to prototype and doesn't require a Mac/Xcode toolchain
  to build — not chosen because this component is macOS-only either way, so that
  advantage doesn't help non-Mac contributors, and the project needs a real
  distribution story for this piece, not a script.

## Build & run (no Xcode project needed)

```bash
swift build
swift run
```

## Contract

Reads `~/.vibehub/status.json`, written by `vibehub/tracker`. Exact schema:
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §4.4. This app never writes that
file and never talks to the VibeHub server directly.

## How it watches the status file

Polls `~/.vibehub/status.json` every 5 seconds (`StatusFileWatcher`), rather than using
a `DispatchSourceFileSystemObject` on an open file descriptor. The tracker writes the
file atomically — temp file, then `rename()` (see BUILD_PLAN §6 item 4) — which swaps
the file's inode on every update. A `DispatchSource` watching the old file descriptor
keeps watching the now-unlinked inode after the first rename and never sees later
writes, so it would silently go stale. A plain poll timer has no such failure mode and
comfortably keeps up with the tracker's default 30s heartbeat interval
(ARCHITECTURE.md §4.2). A missing file or malformed JSON is treated the same as
`"offline"` — nothing to report, not an error state a user needs to see.

## Dashboard URL override

`WEB_APP_URL` defaults to `http://localhost:5173` at build time. Override it for local
testing without rebuilding:

```bash
defaults write VibeHubMenuBar WebAppURL "https://vibehub.app"
```

(per [`../docs/BUILD_PLAN.md`](../docs/BUILD_PLAN.md) §3).

## Build order

See [`../docs/BUILD_PLAN.md`](../docs/BUILD_PLAN.md) §7.
