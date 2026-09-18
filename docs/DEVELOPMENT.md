# Development

Everything here runs from the repo root with Node 20+. Read
[`ARCHITECTURE.md`](ARCHITECTURE.md) first — it is the contract every part is built
against — and [`DESIGN.md`](DESIGN.md) before touching the UI.

## Layout

```
vibehub/
├── docs/           ARCHITECTURE.md, DESIGN.md, INSTALL.md, BUILD_PLAN.md
├── server/         Express + Prisma API + WebSocket (Postgres; SQLite in dev)
├── web/            React + Vite SPA, monochrome design system
├── tracker/        vibehub-tracker — the local CLI that sends heartbeats
├── menubar-mac/    SwiftUI menu-bar app (reads the server)
├── macos/          earlier companion that reads the tracker's local status.json
├── scripts/        smoke.js and other end-to-end checks
└── assets/         branding, screenshots
```

## Run it locally

```bash
npm install                                   # server + web + tracker workspaces

# server — SQLite, zero setup
cp server/.env.example server/.env            # defaults point at SQLite + dev-login
npm run db:generate --workspace server
npm run db:dev      --workspace server        # creates server/prisma/dev.db
npm run db:seed     --workspace server        # demo users: ada, grace, linus
npm run dev:server                            # http://localhost:4000

# web — second terminal
cp web/.env.example web/.env
npm run dev:web                               # http://localhost:5173 → "Dev sign in" as ada
```

Postgres instead of SQLite: set `DATABASE_PROVIDER=postgresql` and `DATABASE_URL` in
`server/.env`, then `npm run db:migrate --workspace server`.

After pulling schema changes (anything under `server/prisma/`) re-run `db:generate`
**and** `db:dev` (Postgres: `db:migrate`). A stale client does not fail at boot — it
fails at query time as HTTP 500s.

### Tracker against a local server

```bash
npm run build --workspace tracker
node tracker/dist/index.js login <token> --api-url http://localhost:4000
node tracker/dist/index.js start        # heartbeats every 30 s
node tracker/dist/index.js status
```

Or fake one: `node scripts/fake-heartbeat.js linus my-proj` makes a seeded friend look
like they are coding right now.

## Checks

```bash
npm run build --workspace server              # tsc
npm run build --workspace web                 # tsc + vite + EOL guard (needs a 4 GB heap: NODE_OPTIONS=--max-old-space-size=4096)
node scripts/smoke.js http://localhost:4000   # end-to-end API assertions, non-zero on failure
node web/scripts/test-one-command-connect.mjs # installer scripts (connect.sh / connect.ps1)
node tracker/scripts/check-ai-only.mjs        # the tracker reads AI session logs and nothing else
```

Unit-style checks live next to the code as `src/lib/__checks__/*.check.ts` and run with
`npx tsx` from the workspace that owns them.

## Deploy (Railway)

Two services and one Postgres, each service built from its own Dockerfile.

```bash
railway init --name vibehub
railway add --database postgres
railway add --service server
railway add --service web
railway domain --service server
railway domain --service web
railway service server
railway volume add --mount-path /app/uploads          # avatars

railway variables --service server --skip-deploys \
  --set 'DATABASE_URL=${Postgres.DATABASE_URL}' --set DATABASE_PROVIDER=postgresql \
  --set NODE_ENV=production --set JWT_SECRET=<48 random bytes hex> \
  --set CORS_ORIGIN=https://<web>.up.railway.app --set COOKIE_SAME_SITE=none \
  --set DEV_LOGIN_ENABLED=false \
  --set GITHUB_CLIENT_ID=<oauth app> --set GITHUB_CLIENT_SECRET=<oauth app> \
  --set GITHUB_CALLBACK_URL=https://<server>.up.railway.app/api/v1/auth/github/callback \
  --set GITHUB_TOKEN=<read-only PAT, no scopes>       # 5000 GitHub req/h for project cards
railway variables --service web --skip-deploys \
  --set VITE_API_URL=https://<server>.up.railway.app \
  --set VITE_WS_URL=wss://<server>.up.railway.app/ws

railway up ./server --path-as-root --service server --detach
railway up ./web    --path-as-root --service web    --detach
```

The server runs `prisma migrate deploy` on boot, so schema changes ship with
`railway up`. Data lives in Postgres, avatars on the `/app/uploads` volume; both survive
redeploys (`scripts/check-avatar-persistence.js` proves it).

## macOS menu bar

[`menubar-mac/`](../menubar-mac/README.md) — SwiftUI, macOS 13+, no dependencies. Shows
your presence, today's time and tokens, and which friends are online, using a tracker
token from the Keychain. `swift run` to iterate, `./scripts/bundle.sh` for a signed
`.app`; prebuilt zips come from the `menubar-mac` GitHub Actions workflow.

## Contributing

Pick one folder, read its section in `ARCHITECTURE.md`, respect the interface contracts
in §5, open a PR against just that folder. Keep the UI monochrome — the single green is
`--vh-live`, and it means "coding right now".
