// Read-only: find one public project id to screenshot anonymously.
//   railway ssh --service server -- node -e "$(cat scripts/public-project.js)"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
prisma.project
  .findFirst({ where: { isPublic: true }, select: { id: true, name: true, ownerId: true } })
  .then((p) => console.log(JSON.stringify(p)))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
