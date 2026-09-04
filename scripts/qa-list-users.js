// Ops helper (read-only): list all prod users for the Round 5 Phase 6 stop
// verification — see meta/plans/vibehub-round5-polish.md.
//
//   railway ssh --service server -- node -e "$(cat scripts/qa-list-users.js)"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

prisma.user
  .findMany({
    select: {
      id: true,
      username: true,
      githubUsername: true,
      isDevAccount: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  .then((u) => console.log(JSON.stringify(u, null, 2)))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
