// Ops helper (read-only): simulate the NEW GET /users/me/tracker payload for
// `anal` against real prod data, side by side with the OLD (buggy) logic, to
// verify the fix before deploying it. No writes, no route/schema changes.
//
//   railway ssh --service server -- node -e "$(cat scripts/qa-tracker-route-verify.js)"
const { PrismaClient } = require("@prisma/client");
const { presenceFor } = require("./dist/lib/sessions.js");
const prisma = new PrismaClient();

async function main() {
  const targetUsername = process.argv.slice(1).filter((a) => !a.endsWith(".js") && a.trim())[0] || "anal";
  const user = await prisma.user.findUnique({ where: { username: targetUsername } });
  const userId = user.id;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [tokens, sessions, latestHeartbeat, presence] = await Promise.all([
    prisma.trackerToken.findMany({ where: { userId, revokedAt: null }, select: { lastUsedAt: true } }),
    prisma.session.findMany({
      where: { userId, lastHeartbeatAt: { gte: since } },
      distinct: ["tool"],
      select: { tool: true },
      orderBy: { lastHeartbeatAt: "desc" },
    }),
    prisma.session.findFirst({ where: { userId }, orderBy: { lastHeartbeatAt: "desc" }, select: { lastHeartbeatAt: true } }),
    presenceFor(userId, user.username),
  ]);

  const tokenLastUsedAt = tokens.reduce(
    (max, t) => (t.lastUsedAt && (!max || t.lastUsedAt > max) ? t.lastUsedAt : max),
    null
  );

  const OLD_payload = {
    connected: tokenLastUsedAt !== null,
    lastSeenAt: tokenLastUsedAt,
    activeTokens: tokens.length,
    tools: sessions.map((s) => s.tool),
  };

  const NEW_payload = {
    connected: presence.status !== "offline",
    lastSeenAt: latestHeartbeat ? latestHeartbeat.lastHeartbeatAt : null,
    activeTokens: tokens.length,
    tools: sessions.map((s) => s.tool),
    tokenLastUsedAt,
  };

  console.log("presenceFor() status:", presence.status);
  console.log("OLD payload:", JSON.stringify(OLD_payload, null, 2));
  console.log("NEW payload:", JSON.stringify(NEW_payload, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
