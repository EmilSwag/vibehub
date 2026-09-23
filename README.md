<p align="center">
  <img src="assets/branding/banner.png" alt="VibeHub" width="560">
</p>

<h3 align="center">Steam, for people who ship with an AI pair.</h3>

<p align="center">
  A profile, friends, a live "coding right now" status, and honest stats on the tokens
  and dollars you burn per model — collected from your AI tools, nothing else.
</p>

<p align="center">
  <a href="https://web-production-da778.up.railway.app"><b>Open VibeHub</b></a>
  &nbsp;·&nbsp;
  <a href="docs/INSTALL.md">Install the tracker</a>
  &nbsp;·&nbsp;
  <a href="docs/ARCHITECTURE.md">Architecture</a>
  &nbsp;·&nbsp;
  <a href="docs/DEVELOPMENT.md">Development</a>
</p>

<p align="center">
  <img src="assets/screenshots/profile.png" alt="A public VibeHub profile: presence and last online, level, stats with a USD estimate, top model, top tool, streak, and per-model cost" width="900">
</p>

## What you get

- **Live status** — friends see *in project neon-app · Claude Code · 1h 42m* the moment
  you start. Last online is on your profile for everyone.
- **Stats that cost money** — active time, tokens and an estimated **$** per model,
  your streak, and the tool you use most.
- **Projects** — paste a GitHub link and you get a real card: cover, description,
  language, stars, README, file browser, recent pushes.
- **Achievements** — six badges earned from real sessions, never inferred: Token
  Millionaire, Opus Tamer, Night Owl, Deep Flow, Polyglot, Streak Master. A real unlock
  gets a toast and fireworks; a locked one shows exactly how far you are.
- **Vibe Feed** — what you and your friends actually did: finished sessions, unlocks,
  new projects, commit days, new friendships. React with *respect* or *flame*.
- **Friends** — add by username, like projects, see who is online.
- **Strictly monochrome.** One colour: green means *coding right now*.

<p align="center">
  <img src="assets/screenshots/project.png" alt="A full project page built from a GitHub link: title and links, languages, README, file browser, CI status, release tag, recent pushes" width="900">
</p>

## Connect your machine — one command

Sign in with GitHub, go to **Settings → Tracker → New token**, then:

**macOS — the app**

```bash
curl -fsSL https://web-production-da778.up.railway.app/tracker/mac.sh | bash
```

Installs `VibeHub.app` — menu bar, notch island, tracker included — and opens it; the app
asks for the token, so nothing above carries one. Or download the `.pkg` from **Settings →
Tracker → macOS app** or from [Releases](https://github.com/EmilSwag/vibehub/releases/latest),
which is also where you press *Create a device key* to get the one the app asks for.
Tracking starts when you start it in the app, then resumes at every login until you turn
it off. This build is not notarised yet, so the very first launch needs right-click →
*Open* once.

**macOS / Linux — the connector**

```bash
curl -fsSL https://web-production-da778.up.railway.app/tracker/connect.sh | VIBEHUB_TOKEN='<device token>' bash -s -- --start
```

**Windows**

```powershell
$env:VIBEHUB_TOKEN='<device token>'; & ([scriptblock]::Create((irm https://web-production-da778.up.railway.app/tracker/connect.ps1))) -Start; Remove-Item Env:VIBEHUB_TOKEN
```

```
✓ [1/5] Node.js ready
✓ [2/5] Tracker downloaded
✓ [3/5] Device token verified as @you
✓ [4/5] Configuration saved
✓ [5/5] Start running
Open VibeHub — it turns green after the first ping.
```

The connector adds nothing to autostart. It writes one command so the rest work by name —
`~/.local/bin/vibehub-tracker`, or `%LOCALAPPDATA%\Programs\VibeHub\vibehub-tracker.cmd` on
Windows, per user and with no administrator — and `vibehub-tracker uninstall` takes that
back out along with any Cursor/Windsurf hook it installed. To remove the rest, `stop` and
delete `~/.vibehub`.
The Mac app does start at login — after you ask it to, and only until you turn it off.
Details, manage commands and troubleshooting: [docs/INSTALL.md](docs/INSTALL.md).

## Your tools

| | Activity | Model | Tokens & $ | Turned on by |
|---|---|---|---|---|
| Claude Code | yes | yes | **measured** | nothing — the log is there |
| Codex | yes | yes | **measured** | nothing — the log is there |
| Quadcode AI | yes | yes | not reported | nothing — the log is there |
| Cursor | yes | when recognised | not reported | `vibehub-tracker hooks install cursor` |
| Windsurf | yes | when recognised | not reported | `vibehub-tracker hooks install windsurf` |

Cursor and Windsurf write no session log, so they are reported through their own official
hooks: the IDE runs one VibeHub command when an AI turn finishes and it appends a single
metadata line. Nothing happens until you install it, and `hooks uninstall` takes it back
out. ChatGPT in the browser or the desktop app is **not** tracked — there is no local
record to read, and we would rather say so than guess.

## Privacy

The tracker reads **only** the sources in that table. It sends tool, model, timestamps,
token counts, a project alias and your clock's UTC offset (so a night session is judged
in your own time zone, not guessed) — never code, prompts, diffs, window titles or
anything about other apps. Three of the five tools report no usage at all, so their rows say
*tokens not reported* and stay out of the $ estimate: a number we cannot measure is never
one we invent. Profiles and stats are public; live presence is for friends. Full model:
[Architecture §3](docs/ARCHITECTURE.md).

## Built with

TypeScript end to end — Express + Prisma + WebSocket on Postgres, React + Vite, a
single-file Node tracker, and a SwiftUI menu-bar app for macOS. Hosted on Railway.

## License

[MIT](LICENSE)
