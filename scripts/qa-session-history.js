// Ops helper (read-only): full Session (tracker heartbeat) history per user,
// any status, to check whether real heartbeat data exists on prod at all —
// see meta/plans/vibehub-round5-polish.md Phase 6.
//
//   railway ssh --service server -- node -e "$(cat scripts/qa-session-history.js)"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      username: true,
      sessions: {
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          status: true,
          tool: true,
          projectAlias: true,
          startedAt: true,
          lastHeartbeatAt: true,
          endedAt: true,
        },
      },
    },
  });
  console.log(JSON.stringify(users, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
