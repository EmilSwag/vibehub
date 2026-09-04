import "dotenv/config";
import { prisma } from "../src/db";
import { presenceFor } from "../src/lib/sessions";
import { generateRawToken, hashToken } from "../src/lib/crypto";

// Local-only proof for Round 5 Phase 8: constructs the exact divergent case
// (a used tracker token, zero heartbeats ever) that GET /users/me/tracker's
// old TrackerToken.lastUsedAt-based `connected` got wrong, and shows the new
// presenceFor()-based logic getting it right. Never touches prod.
//
//   npx tsx scripts/local-divergence-check.ts

const USERNAME = "qa-divergence-test";

async function main() {
  let user = await prisma.user.findUnique({ where: { username: USERNAME } });
  if (!user) {
    user = await prisma.user.create({ data: { username: USERNAME, displayName: USERNAME, isDevAccount: true } });
  }

  // A used token: lastUsedAt set, as /tracker/verify (called by `login`) does —
  // but no Session row at all, i.e. the daemon never actually sent a heartbeat.
  const raw = generateRawToken();
  await prisma.trackerToken.create({
    data: { userId: user.id, label: "divergence-proof", tokenHash: hashToken(raw), lastUsedAt: new Date() },
  });

  const sessionCount = await prisma.session.count({ where: { userId: user.id } });
  console.log(`user: ${user.username}  sessions on this account: ${sessionCount} (must be 0 for this proof)`);

  // Mirrors GET /users/me/tracker exactly (server/src/routes/users.ts).
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [tokens, sessions, latestHeartbeat, presence] = await Promise.all([
    prisma.trackerToken.findMany({ where: { userId: user.id, revokedAt: null }, select: { lastUsedAt: true } }),
    prisma.session.findMany({
      where: { userId: user.id, lastHeartbeatAt: { gte: since } },
      distinct: ["tool"],
      select: { tool: true },
      orderBy: { lastHeartbeatAt: "desc" },
    }),
    prisma.session.findFirst({ where: { userId: user.id }, orderBy: { lastHeartbeatAt: "desc" }, select: { lastHeartbeatAt: true } }),
    presenceFor(user.id, user.username),
  ]);
  const tokenLastUsedAt = tokens.reduce<Date | null>(
    (max, t) => (t.lastUsedAt && (!max || t.lastUsedAt > max) ? t.lastUsedAt : max),
    null
  );

  const OLD_payload = { connected: tokenLastUsedAt !== null, lastSeenAt: tokenLastUsedAt, activeTokens: tokens.length, tools: sessions.map((s) => s.tool) };
  const NEW_payload = {
    connected: presence.status !== "offline",
    lastSeenAt: latestHeartbeat?.lastHeartbeatAt ?? null,
    activeTokens: tokens.length,
    tools: sessions.map((s) => s.tool),
    tokenLastUsedAt,
  };

  console.log("presenceFor() status:", presence.status);
  console.log("OLD payload:", JSON.stringify(OLD_payload, null, 2));
  console.log("NEW payload:", JSON.stringify(NEW_payload, null, 2));
  console.log(
    OLD_payload.connected !== NEW_payload.connected
      ? "DIVERGES as expected: OLD says connected, NEW correctly says not connected."
      : "DID NOT DIVERGE — proof setup is wrong, investigate."
  );

  await prisma.user.delete({ where: { id: user.id } }); // cascades TrackerToken
  console.log("cleanup: test user deleted");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
