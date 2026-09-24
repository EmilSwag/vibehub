# VibeHub for macOS

The native companion for [VibeHub](../README.md): a menu-bar app plus a floating panel
beside the notch, and the tracker itself — bundled inside the app, not a separate
install. macOS 13+, no Swift package dependencies (URLSession + Codable only).

## What it is

- **Menu bar item** — the VibeHub mark as a template glyph, plus today's active time if
  you leave that toggle on. Click it for the popover: header, Now, Today (time, tokens,
  ≈$), Friends online, and actions.
- **Island** — a small panel that hugs the notch (below the menu bar, top-centre, on a
  Mac without one). Collapsed: presence dot · today's time · tokens/≈$. Hover to
  spring-expand into a card with the same data as the popover; it auto-collapses on
  mouse-out, on a click outside, or on Escape after you have clicked it. Setting:
  **Auto** (shows once there's something to show) / **Always** / **Off**. It hides on a
  display that is running a full-screen app.
- **The tracker** — `vibehub-tracker.cjs` and a private Node runtime ship inside
  `VibeHub.app`. **Start tracking** does two things in one approved step: it registers a
  `com.vibehub.tracker` LaunchAgent (`~/Library/LaunchAgents`, `RunAtLoad`, restart on
  crash only — `KeepAlive { SuccessfulExit: false }` — 30s throttle) so the tracker runs
  at every login whether or not the app is open, and it registers the app itself as a
  login item (`SMAppService`) so the menu bar and Island come back too. **Off** undoes
  both, asks the daemon to close its session cleanly, and is remembered: no upgrade,
  reinstall or app launch turns tracking back on until you do.

It talks to the server directly (`GET /api/v1/tracker/me`) for what it shows, and
separately drives the embedded tracker CLI (`login`, `stop`, `logout`, and the
LaunchAgent's `serve`) for background tracking — the two are independent, so the
popover/Island work before "Start tracking" has ever been pressed.

## Install

**Installer (recommended):** download `VibeHub.pkg` from the
[latest `mac-v*` release](../../releases), open it, follow the prompts. VibeHub opens on
its own once the install finishes.

**One command**, from the web (Settings → Tracker → macOS): a `curl … | bash` that
resolves the same pkg through `GET /api/v1/mac/latest`, verifies its SHA-256, installs
it and opens the app. It carries **no token** — neither entrance does. The app asks
for the token once, on first run, whichever way it was installed.

**Manual:** download `VibeHub-macOS.zip` from the same release, unzip it, drag
**VibeHub.app** to `/Applications`, then open it. If macOS blocks first launch (unnotarised
ad-hoc build), go to **System Settings → Privacy & Security**, scroll down to Security,
and click **Open Anyway** (on macOS 14 and earlier, right-click → Open in Finder also works).
After that it launches normally.

`/Applications` (or `~/Applications`) is required for tracking, not just recommended:
the LaunchAgent records the app bundle's absolute paths, and `SMAppService` refuses to
register a login item for an app running from `~/Downloads`, a disk image or `.build/`.
"Start tracking" checks and says so instead of half-enabling.

## First run

Welcome → click "Connect in Browser" to pair with one click → Start tracking → Done.
(Manual device key entry from Settings → Tracker is also supported if needed).
The app verifies the token against the server before saving it anywhere; then it goes
into the login Keychain (this device only, never synced) and, via the embedded CLI's
`login --token-stdin`, into the tracker's own `~/.vibehub/config.json`. It is never placed
in a preferences file, an argument vector, an environment variable, a URL or a log.

A `~/.vibehub/handoff.json` written by the one-command installer, or a
`vibehub://connect?apiUrl=…&webUrl=…` link, can only point the app at a different
server (a staging install). A `token` in either is ignored, not forwarded.

## Settings

Inside the popover (**Settings**):

- **Tracker token** — replace it, or **Sign out**. Replacing the token with a different
  account's stops the running tracker, releases this device's connection, clears the
  old account's local state, then signs in and restarts tracking on the new one. Sign
  out does all of that and removes the LaunchAgent, the login item and the Keychain
  entry — the machine forgets the account, not just the app.
- **Show today's time in the menu bar** — the "2h 14m" beside the glyph.
- **Start with my Mac** — one switch for the tracker's LaunchAgent *and* the app's login
  item; they are one decision. Turning it off keeps it off across updates.
- **Island** — Auto / Always / Off.

The server the app itself points at can be changed without a rebuild:

```bash
defaults write com.vibehub.menubar BaseURL "http://localhost:4000"
defaults write com.vibehub.menubar WebURL "http://localhost:3000"
```

Restart the app afterwards; it reads these once at launch.

## Upgrades

A pkg upgrade replaces the embedded Node runtime and tracker bundle underneath a
LaunchAgent that still points at the old files. On the first launch after an upgrade,
if tracking is on, the app rewrites the plist from the new bundle's paths and restarts
the job. If tracking was turned off, an upgrade leaves it off.

## Build from source

Requires the Xcode toolchain (`swift`, `iconutil`, `codesign`, `pkgbuild`,
`productbuild`, `lipo`). No Python.

```bash
swift run                          # iterate locally — UI only, no embedded tracker
swift build -c release             # binary only
./scripts/bundle.sh                # universal .app + zip in dist/, tracker embedded
./scripts/make-pkg.sh              # dist/VibeHub.pkg + .sha256 (needs bundle.sh first)
```

`bundle.sh` builds both architectures (`swift build --arch arm64` / `--arch x86_64`),
`lipo`s them into one universal binary, assembles the bundle, generates the icon,
embeds the tracker (`scripts/embed-tracker.sh` — downloads the pinned private Node
runtime for both architectures, verifies SHA-256, `lipo`s those too, copies
`web/public/tracker/vibehub-tracker.cjs`), signs, and zips with `ditto`. The icon is
the VibeHub mark, drawn programmatically by `scripts/make-icon.swift` from the same
numbers as `Sources/VibeHub/BrandMark.swift` into an `.iconset` and converted with
`iconutil` — no rasteriser to install, no binary blob in git.

`make-pkg.sh` wraps the built `.app` with `pkgbuild` (component package + postinstall
script that opens VibeHub as the console user) and `productbuild` (the
welcome/license/conclusion distribution UI, `pkg/Distribution.xml` +
`pkg/resources/`). Installer artwork is optional and per appearance:
`pkg/resources/background.png`/`@2x` (ink mark, light window) and
`background-dark.png`/`@2x` (paper mark, Dark Mode); the script emits a
`<background>`/`<background-darkAqua>` element only for the files that exist and builds
a plainer, still-working installer without them.

Embedded-tracker pin (Node **v24.21.0**, darwin-arm64/x64 SHA-256) lives in
`scripts/embed-tracker.sh` and must match `web/public/tracker/connect.sh` and
`web/public/tracker/runtime-manifest.json` exactly — the one-command web installer and
the app embed the *same* private runtime, just fetched at different times.

The embedded CLI must provide two things the app relies on, both from `tracker/`:
`login --token-stdin` (the token is written to the CLI's stdin, never argv) and the
hidden `serve` command the LaunchAgent runs. CI's "Verify embedded tracker contract"
step refuses a bundle that lacks either.

## Signing

Ad-hoc by default (no Developer ID, no notarisation) — if blocked on first launch, allow via
**System Settings → Privacy & Security → Open Anyway** (or right-click → Open on macOS 14 and earlier), as
above. CI (`.github/workflows/mac.yml`) signs and notarises for real once these repo
secrets exist; until then it silently falls back to ad-hoc, same as running the scripts
locally with no environment variables set:

| Secret | Used for |
|---|---|
| `MACOS_APP_CERTIFICATE_P12` / `MACOS_APP_CERTIFICATE_PASSWORD` | Import a **Developer ID Application** cert into a temporary CI keychain |
| `MACOS_INSTALLER_CERTIFICATE_P12` / `MACOS_INSTALLER_CERTIFICATE_PASSWORD` | Import a **Developer ID Installer** cert (a different certificate type — required for signing a `.pkg`) |
| `MACOS_KEYCHAIN_PASSWORD` | Password for that temporary keychain |
| `MACOS_APP_SIGN_IDENTITY` | Exact identity string, e.g. `Developer ID Application: Name (TEAMID)` — passed to `codesign` |
| `MACOS_INSTALLER_SIGN_IDENTITY` | Exact identity string, e.g. `Developer ID Installer: Name (TEAMID)` — passed to `productbuild --sign` |
| `MACOS_NOTARY_KEY_ID` / `MACOS_NOTARY_ISSUER_ID` / `MACOS_NOTARY_KEY_P8` (base64) | An App Store Connect API key, for `xcrun notarytool` — no interactive setup needed, unlike a stored keychain profile |

Locally, the equivalent environment variables are `VIBEHUB_SIGN_IDENTITY`
(`bundle.sh`) and `VIBEHUB_PKG_SIGN_IDENTITY` / `VIBEHUB_NOTARY_PROFILE` or
`VIBEHUB_NOTARY_KEY_ID`/`VIBEHUB_NOTARY_ISSUER_ID`/`VIBEHUB_NOTARY_KEY_PATH`
(`make-pkg.sh`) — see the comments at the top of each script.

## Releasing

CI lives at [`.github/workflows/mac.yml`](../.github/workflows/mac.yml). It builds the
universal app, verifies the bundle (including that the embedded Node binary is
genuinely universal and that the embedded tracker carries the commands the app needs),
builds and verifies the pkg, and uploads both as artifacts on every push touching
`mac/**` or the workflow file, and on manual dispatch.

Pushing a `mac-v*` tag also cuts a GitHub Release with `VibeHub.pkg`,
`VibeHub.pkg.sha256` and `VibeHub-macOS.zip` attached. Bump
`CFBundleShortVersionString` in `Resources/Info.plist` in the release commit and tag
that commit — `make-pkg.sh` reads the pkg version from that same field, and the app's
upgrade repair compares it across launches, so there is exactly one place to bump it —
and the workflow's path filter applies to tag pushes too, so tagging a commit that
doesn't touch `mac/` won't start a build. (If that happens, run the workflow by hand
with **workflow_dispatch**.) The server's `GET /api/v1/mac/latest` resolves the newest
`mac-v*` release for the web download tab and the one-command installer.

## Polling

15s with the popover closed, 3s while it's open, with exponential back-off (capped at
5 minutes) once requests start failing. A blip keeps the last good snapshot on screen;
the error state only appears once failures repeat. A rejected token stops the loop
rather than retrying forever. The Island shares this same poll loop (`StatusStore`) —
it does not poll separately. Local daemon state (`~/.vibehub/status.json`,
`tracker.pid`) is read every 5s and never asked of the server; a snapshot older than
90s, or with no live pid behind it, is shown as stale, and "connected" there means the
daemon reached the server — never that an AI tool is in use.

## What only a real Mac can verify

Nothing in this directory has been compiled or run where it was written; CI on
`macos-14` is the first compiler it meets. Beyond a green build: pkg install → token
prompt → Start → tracker survives reboot → Island shows data; Island placement on
notched, notchless and multi-display setups; hover/click delivery to a
`.nonactivatingPanel`; Escape after a click; the upgrade repair; and signing/notarisation
once the secrets exist. The plan (`meta/plans/vibehub-mac-app.md`) keeps the list.
