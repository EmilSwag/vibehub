// Ops helper (runs inside the deployed server container): read-only comparison of
// each user's raw last-session state vs. the live presenceFor() computation — the
// exact function GET /api/v1/presence/friends calls per-request. No writes.
//
//   railway ssh --service server -- node -e "$(cat scripts/presence-check.js)"
//   railway ssh --service server -- node -e "$(cat scripts/presence-check.js)" -- --interval=10
//
// --interval[=SECONDS] (default 10) re-runs the query and re-prints the table
// on that interval — watch mode, so an operator can watch presence decay
// across active/idle/offline live. Ctrl+C to stop — it otherwise runs forever.
// The `--` before the flag is required: without it `node -e` swallows
// `--interval=N` as an unrecognized node CLI option ("bad option") rather than
// passing it to the script; a literal `--watch` flag fares even worse — node
// intercepts it as its own built-in file watcher and refuses to start
// ("either --watch or --eval can be used, not both"). Both confirmed against
// prod before landing on this name + invocation.
const { PrismaClient } = require("@prisma/client");
const { presenceFor } = require("./dist/lib/sessions.js");
const prisma = new PrismaClient();

const watchArg = process.argv.slice(1).find((a) => a.startsWith("--interval"));
const watchSeconds = watchArg ? Number(watchArg.split("=")[1] || 10) || 10 : null;

const COLUMNS = ["username", "lastHeartbeatAt", "age", "stored", "derived", "tool"];

function pad(value, width) {
  const s = String(value);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function printTable(rows) {
  const widths = COLUMNS.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (cells) => cells.map((c, i) => pad(c, widths[i])).join("  ");
  console.log(line(COLUMNS));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const r of rows) console.log(line(COLUMNS.map((c) => r[c])));
}

async function snapshot() {
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  const rows = [];
  for (const u of users) {
    const session = await prisma.session.findFirst({
      where: { userId: u.id, status: { not: "ENDED" } },
      orderBy: { lastHeartbeatAt: "desc" },
      select: { status: true, lastHeartbeatAt: true },
    });
    const computed = await presenceFor(u.id, u.username);
    rows.push({
      username: u.username,
      lastHeartbeatAt: session ? session.lastHeartbeatAt.toISOString() : "—",
      age: session ? `${Math.round((Date.now() - session.lastHeartbeatAt.getTime()) / 1000)}s` : "—",
      stored: session ? session.status : "—",
      derived: computed.status,
      tool: computed.activity ? computed.activity.tool : "—",
    });
  }
  printTable(rows);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!watchSeconds) {
    await snapshot();
    return;
  }
  for (;;) {
    console.log(`\n--- ${new Date().toISOString()} (every ${watchSeconds}s, Ctrl+C to stop) ---`);
    await snapshot();
    await sleep(watchSeconds * 1000);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!watchSeconds) prisma.$disconnect();
  });
