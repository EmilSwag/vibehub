// Ops helper (read-only): check FriendRequest rows between vh-qa-alice/vh-qa-bob
// for Round 5 Phase 6 Step 2 verification.
//
//   railway ssh --service server -- node -e "$(cat scripts/qa-friend-check.js)"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

prisma.friendRequest
  .findMany({
    where: { OR: [{ sender: { username: { startsWith: "vh-qa-" } } }, { receiver: { username: { startsWith: "vh-qa-" } } }] },
    include: { sender: { select: { username: true } }, receiver: { select: { username: true } } },
  })
  .then((rows) =>
    console.log(JSON.stringify(rows.map((r) => ({ from: r.sender.username, to: r.receiver.username, status: r.status, createdAt: r.createdAt })), null, 2))
  )
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
