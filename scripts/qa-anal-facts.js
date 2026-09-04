// Ops helper (read-only): compact real-value facts for `anal` — tokens,
// latest Session (incl. model), latest ActivityEvent.
//
//   railway ssh --service server -- node -e "$(cat scripts/qa-anal-facts.js)"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { username: "anal" } });

  const tokens = await prisma.trackerToken.findMany({
    where: { userId: user.id },
    select: { lastUsedAt: true, revokedAt: true },
  });

  const latestSession = await prisma.session.findFirst({
    where: { userId: user.id },
    orderBy: { startedAt: "desc" },
  });

  const latestEvent = await prisma.activityEvent.findFirst({
    where: { userId: user.id },
    orderBy: { occurredAt: "desc" },
  });

  console.log(
    JSON.stringify(
      {
        tokens: { count: tokens.length, lastUsedAt: tokens.map((t) => t.lastUsedAt).sort().pop(), revokedAt: tokens.map((t) => t.revokedAt).filter(Boolean) },
        latestSession,
        latestEvent,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
