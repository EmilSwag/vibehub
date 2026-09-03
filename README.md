<p align="center">
  <img src="assets/branding/banner.png" alt="VibeHub" width="640">
</p>

# VibeHub

**Steam, for people who ship with an AI pair.** VibeHub is an open-source social
platform for AI-assisted developers: a profile, friends, a privacy-safe live status
("in project neon-app · Claude Code · 1h 42m"), stats on tokens/time per model and
GitHub activity, and project cards friends can browse and like. Strictly monochrome UI.

No code, diffs, or prompts ever leave your machine — the local tracker only ever sends
a project name, a tool/model name, token counts, and timestamps. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §3 for the full privacy model.

## Live

| | |
|---|---|
| Web app | **https://web-production-da778.up.railway.app** |
| API / WebSocket | `https://server-production-cc06.up.railway.app` (`/api/v1`, `/ws`) |
| Health | `GET /api/v1/health` |

Sign in, add your friends by username, paste a tracker token into `vibehub-tracker` and
your live status shows up on their home screen.

> **Auth note.** The hosted instance currently runs with `DEV_LOGIN_ENABLED=true`, i.e.
> you sign in by picking a username (no password). That's fine for a trusted friend
> group, but anyone with the URL can claim any name. To lock it down, create a GitHub
> OAuth App and set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` on the server, then
> flip `DEV_LOGIN_ENABLED=false` — the login page adapts automatically.

## Status

Server, web and tracker are feature-complete against
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and deployed. `scripts/smoke.js` runs 73
end-to-end checks over the whole REST surface. The macOS menu-bar companion (`macos/`)
is scaffolded but not yet built.

## Monorepo layout

```
vibehub/
├── docs/           ARCHITECTURE.md, BUILD_PLAN.md — read these first
├── server/         Express + Prisma API + WebSocket (Postgres, SQLite in dev)
├── web/            React + Vite SPA, monochrome design system
├── tracker/        vibehub-tracker — local CLI, Discord-Rich-Presence-style heartbeats
├── macos/          Swift menu-bar companion app
└── assets/branding/
```

## Quickstart (dev)

Requires Node 20+, Docker (for local Postgres) or nothing extra if you use the SQLite
dev fallback, and Xcode command line tools / Swift toolchain only if you're working on
`macos/`.

```bash
npm install                                   # installs server + web + tracker workspaces

# server — Option A: SQLite (zero setup)
cp server/.env.example server/.env            # defaults already point at SQLite + dev-login
npm run db:generate --workspace server        # Prisma clients (postgres + sqlite)
npm run db:dev      --workspace server        # creates server/prisma/dev.db
npm run db:seed     --workspace server        # 3 demo users: ada, grace, linus (friends, stats, wall)
npm run dev:server                            # http://localhost:4000

# server — Option B: Postgres
#   set DATABASE_PROVIDER=postgresql + DATABASE_URL in server/.env, then
#   npm run db:migrate --workspace server && npm run dev:server

# web — in another terminal
cp web/.env.example web/.env                  # VITE_API_URL=http://localhost:4000, VITE_WS_URL=ws://localhost:4000/ws
npm run dev:web                               # http://localhost:5173  → "Dev sign in" as ada

# end-to-end API check against a running server
node scripts/smoke.js http://localhost:4000   # 73 checks, exits non-zero on failure
node scripts/fake-heartbeat.js linus my-proj  # make a seeded friend look "coding right now"
```

### Tracker (your machine → your friends' home screen)

```bash
npm run build --workspace tracker
# Web → Settings → Tracker tokens → "New token", then:
node tracker/dist/index.js login <token>                 # defaults to the hosted server
node tracker/dist/index.js login <token> --api-url http://localhost:4000   # local server
node tracker/dist/index.js start                         # background daemon, heartbeats every 30s
node tracker/dist/index.js status
node tracker/dist/index.js set ~/code/secret-thing "(hidden)"   # rename or hide a project
```

For the macOS companion (WIP):

```bash
cd macos
swift run   # no Xcode project needed for local iteration
```

## Deploying to Railway

Two services + one Postgres, all from this repo:

```bash
railway init --name vibehub
railway add --database postgres
railway add --service server
railway add --service web
railway domain --service server          # → https://<server>.up.railway.app
railway domain --service web             # → https://<web>.up.railway.app
railway service server                   # link, then attach persistent storage for avatars:
railway volume add --mount-path /app/uploads

railway variables --service server --skip-deploys \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --set DATABASE_PROVIDER=postgresql \
  --set NODE_ENV=production --set JWT_SECRET=<48 random bytes hex> \
  --set CORS_ORIGIN=https://<web>.up.railway.app --set COOKIE_SAME_SITE=none \
  --set DEV_LOGIN_ENABLED=true \
  --set GITHUB_CALLBACK_URL=https://<server>.up.railway.app/api/v1/auth/github/callback
railway variables --service web --skip-deploys \
  --set VITE_API_URL=https://<server>.up.railway.app \
  --set VITE_WS_URL=wss://<server>.up.railway.app/ws

# each service builds from its own Dockerfile; --path-as-root makes the subfolder the build context
railway up ./server --path-as-root --service server --detach
railway up ./web    --path-as-root --service web    --detach
```

The server image runs `prisma migrate deploy` on boot, so schema changes ship with
`railway up`. Persistence: application data lives in Postgres (its own Railway volume),
avatars on the server volume mounted at `/app/uploads` (override the path with
`UPLOAD_DIR`). Both survive redeploys; `scripts/check-avatar-persistence.js` proves it.
Design notes: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §8.

## Contributing

This is early — the four workstreams in `docs/BUILD_PLAN.md` are written so they can be
picked up independently. Pick one, read its section, respect the frozen interface
contracts in §2, and open a PR against just that folder.

## License

MIT.
