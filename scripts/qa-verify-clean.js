// Ops helper (read-only): verify prod carries no stray/QA test users and that the
// two named real accounts are untouched. Written for the Round 5 Phase 6 stop —
// see meta/plans/vibehub-round5-polish.md.
//
//   railway ssh --service server -- node -e "$(cat scripts/qa-verify-clean.js)"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const stray = await prisma.user.findMany({
    where: { username: { in: ["v", "vh-qa-alice", "vh-qa-bob"] } },
    select: { id: true, username: true },
  });
  console.log(`stray/QA users: ${stray.length === 0 ? "none" : JSON.stringify(stray)}`);

  const orphanSessions = await prisma.authSession.count({
    where: { user: { username: { in: ["v", "vh-qa-alice", "vh-qa-bob"] } } },
  });
  console.log(`sessions tied to stray/QA users: ${orphanSessions}`);

  const protectedUsers = await prisma.user.findMany({
    where: { username: { in: ["emilswag", "borissharikoff-droid"] } },
    select: { id: true, username: true, updatedAt: true, onboardedAt: true },
  });
  console.log(`protected users: ${JSON.stringify(protectedUsers)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
