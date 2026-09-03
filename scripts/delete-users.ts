// Ops helper: hard-delete users by username (cascades to sessions, stats, friendships,
// wall comments, projects, tokens via the Prisma schema's onDelete rules).
//
//   DATABASE_URL=<postgres url> npx tsx scripts/delete-users.ts smoke-abc123 ada
//
// Run from the repo root so `server/src/db` resolves. Refuses to run with no arguments.
import { prisma } from "../server/src/db";

async function main() {
  const usernames = process.argv.slice(2).map((u) => u.trim()).filter(Boolean);
  if (usernames.length === 0) {
    console.error("usage: delete-users.ts <username> [username...]");
    process.exit(2);
  }
  const found = await prisma.user.findMany({ where: { username: { in: usernames } }, select: { id: true, username: true } });
  if (found.length === 0) {
    console.log("no matching users");
    return;
  }
  const result = await prisma.user.deleteMany({ where: { id: { in: found.map((u) => u.id) } } });
  console.log(`deleted ${result.count}: ${found.map((u) => u.username).join(", ")}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
