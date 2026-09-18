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
  <img src="assets/screenshots/profile.png" alt="Profile stats: active time, top model, top tool, streak, tokens with a USD estimate, and per-model cost" width="900">
</p>

## What you get

- **Live status** — friends see *in project neon-app · Claude Code · 1h 42m* the moment
  you start. Last online is on your profile for everyone.
- **Stats that cost money** — active time, tokens and an estimated **$** per model,
  your streak, and the tool you use most.
- **Projects** — paste a GitHub link and you get a real card: cover, description,
  language, stars, README, file browser, recent pushes.
- **Friends & feed** — add by username, like projects, see who is online.
- **Strictly monochrome.** One colour: green means *coding right now*.

<p align="center">
  <img src="assets/screenshots/project.png" alt="A project page: languages, README, file browser, recent pushes" width="900">
</p>

## Connect your machine — one command

Sign in with GitHub, go to **Settings → Tracker → New token**, then:

**macOS / Linux**

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

Nothing is added to autostart; `stop` and delete `~/.vibehub` to remove it.
Details, manage commands and troubleshooting: [docs/INSTALL.md](docs/INSTALL.md).

## Privacy

The tracker reads **only** Claude Code and Codex session logs on your machine. It sends
tool, model, timestamps, token counts and a project alias — never code, prompts, diffs,
window titles or anything about other apps. Profiles and stats are public; live
presence is for friends. Full model: [Architecture §3](docs/ARCHITECTURE.md).

## Built with

TypeScript end to end — Express + Prisma + WebSocket on Postgres, React + Vite, a
single-file Node tracker, and a SwiftUI menu-bar app for macOS. Hosted on Railway.

## License

[MIT](LICENSE)
