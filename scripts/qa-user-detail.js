// Ops helper (read-only): full detail on prod users for the Round 5 Phase 6 stop
// verification — see meta/plans/vibehub-round5-polish.md.
//
//   railway ssh --service server -- node -e "$(cat scripts/qa-user-detail.js)"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      username: true,
      githubUsername: true,
      onboardedAt: true,
      roles: true,
      isDevAccount: true,
      trackerTokens: { select: { revokedAt: true } },
      authSessions: { select: { revokedAt: true, expiresAt: true } },
    },
  });

  const now = new Date();
  const rows = users.map((u) => ({
    username: u.username,
    githubUsername: u.githubUsername,
    onboardedAt: u.onboardedAt,
    roles: u.roles,
    isDevAccount: u.isDevAccount,
    tokens: { total: u.trackerTokens.length, active: u.trackerTokens.filter((t) => !t.revokedAt).length },
    sessions: {
      total: u.authSessions.length,
      live: u.authSessions.filter((s) => !s.revokedAt && s.expiresAt > now).length,
    },
  }));
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
