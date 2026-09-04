// Ops helper (read-only): resolve a raw tracker token to its DB id via the same
// hash the server checks against (never stores/logs the raw value itself).
//
//   railway ssh --service server -- node -e "$(cat scripts/qa-token-id.js)" <raw-token>
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function main() {
  const raw = process.argv.slice(1).filter((a) => !a.endsWith(".js") && a.trim())[0];
  if (!raw) throw new Error("usage: qa-token-id.js <raw-token>");
  const token = await prisma.trackerToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: { id: true, label: true, userId: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
  console.log(JSON.stringify(token, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
