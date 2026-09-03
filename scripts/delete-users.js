// Ops helper (runs inside the deployed server container, where only the compiled
// Postgres client exists): hard-delete users by username. Cascades via schema onDelete.
//
//   railway ssh --service server -- node -e "$(cat scripts/delete-users.js)" smoke-abc ada
//   # or: node scripts/delete-users.js smoke-abc ada   (with DATABASE_URL set)
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const usernames = process.argv.slice(1).filter((a) => !a.endsWith(".js") && a.trim());
  if (usernames.length === 0) throw new Error("usage: delete-users.js <username> [username...]");
  const found = await prisma.user.findMany({ where: { username: { in: usernames } }, select: { id: true, username: true } });
  if (found.length === 0) return console.log("no matching users");
  const result = await prisma.user.deleteMany({ where: { id: { in: found.map((u) => u.id) } } });
  console.log(`deleted ${result.count}: ${found.map((u) => u.username).join(", ")}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
