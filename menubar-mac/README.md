# VibeHub — macOS menu bar

A small SwiftUI menu-bar companion for [VibeHub](../README.md). macOS 13+, no
dependencies, no Dock icon.

It talks to the server directly (`GET /api/v1/tracker/me`) with a tracker token, so it
does **not** need the tracker daemon running on the same machine. That's the difference
from [`macos/`](../macos/), which reads the tracker's local `~/.vibehub/status.json`.

## What it shows

In the menu bar: a monochrome `</>` glyph, plus today's active time ("2h 14m") if you
leave that toggle on.

In the popover:

- **Header** — avatar, display name, `@username`, and a presence dot: filled green while
  active, grey when idle, a hollow ring when offline.
- **Now** — `project · tool · model` with a live timer since the session started. The
  model segment disappears for tools that don't expose one.
- **Today** — active time (ticking live while you're active), tokens, and your level.
- **Friends online: N** — up to four friends with their avatars and current tool.

Actions: Open VibeHub · Go online · Copy tracker token · Settings · Quit.

## Install

1. Download `VibeHub-MenuBar-macOS.zip` from the
   [latest `menubar-v*` release](../../releases), or build it yourself (below).
2. Unzip it.
3. Drag **VibeHub MenuBar.app** to `/Applications`.
4. **Right-click the app → Open**, then confirm — *this first launch only*.

Step 4 is required because the build is ad-hoc signed and not notarised, so Gatekeeper
blocks a plain double-click with "cannot be opened because the developer cannot be
verified". Right-click → Open is macOS's supported override; after that it launches
normally. Moving it to `/Applications` before first launch also matters for the
launch-at-login toggle — `SMAppService` refuses to register an app running from
`~/Downloads` or from `.build/`.

## First run

The popover opens asking for a tracker token.

Mint one on the web under **Settings → Tracker** ("New token"). It is shown once — paste
it straight into the app. It goes into the login Keychain, not a preferences file.

The same token the `vibehub-tracker` CLI uses works here, and one token can serve both.

## Settings

Inside the popover (**Settings**):

- **Tracker token** — replace or clear it. Clearing signs the app out.
- **Show today's time in the menu bar** — the "2h 14m" beside the glyph.
- **Launch at login** — via `SMAppService`.

The server it points at can be changed without a rebuild:

```bash
defaults write com.vibehub.menubar BaseURL "http://localhost:4000"
```

Restart the app afterwards; it reads this once at launch.

## Updating

Quit VibeHub from the menu, then replace the app in `/Applications` with the new unzip.
The token stays in the Keychain, so you won't have to paste it again. The right-click →
Open dance is only needed the first time a given copy runs.

## Build from source

Requires the Swift toolchain (Xcode or the command line tools).

```bash
swift run                          # iterate locally
swift build -c release             # binary only
./scripts/bundle.sh                # .app + zip in dist/
```

`bundle.sh` builds release, assembles the bundle, generates the icon, ad-hoc signs and
zips with `ditto`. The icon is drawn programmatically by `scripts/make-icon.swift` into
an `.iconset` and converted with `iconutil` — no rasteriser to install, no binary blob in
git.

## Releasing

CI lives at [`.github/workflows/menubar-mac.yml`](../.github/workflows/menubar-mac.yml).
It builds and uploads `VibeHub-MenuBar-macOS.zip` on every push touching `menubar-mac/**`
and on manual dispatch.

Pushing a `menubar-v*` tag also cuts a GitHub Release with the zip attached. Bump
`CFBundleShortVersionString` in `Resources/Info.plist` in the release commit and tag that
commit — the workflow's path filter applies to tag pushes too, so tagging a commit that
doesn't touch `menubar-mac/` won't start a build. (If that happens, run the workflow by
hand with **workflow_dispatch**.)

## Polling

15s with the popover closed, 3s while it's open, with exponential back-off (capped at
5 minutes) once requests start failing. A blip keeps the last good snapshot on screen;
the error state only appears once failures repeat. A rejected token stops the loop rather
than retrying forever.
