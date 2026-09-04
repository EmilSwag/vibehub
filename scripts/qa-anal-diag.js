// Ops helper (read-only): Phase 8 diagnostic for `anal` — tracker tokens
// (lastUsedAt), full Session history, and the live presenceFor() computation,
// side by side, so a stored-vs-derived mismatch would be obvious.
//
//   railway ssh --service server -- node -e "$(cat scripts/qa-anal-diag.js)"
const { PrismaClient } = require("@prisma/client");
const { presenceFor } = require("./dist/lib/sessions.js");
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { username: "anal" } });
  const tokens = await prisma.trackerToken.findMany({
    where: { userId: user.id },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    orderBy: { createdAt: "asc" },
  });
  const sessions = await prisma.session.findMany({
    where: { userId: user.id },
    select: { id: true, status: true, tool: true, projectAlias: true, startedAt: true, lastHeartbeatAt: true, endedAt: true },
    orderBy: { startedAt: "desc" },
  });
  const computed = await presenceFor(user.id, user.username);

  console.log("tokens:", JSON.stringify(tokens, null, 2));
  console.log("sessions:", JSON.stringify(sessions, null, 2));
  console.log("presenceFor() computed:", JSON.stringify(computed, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
