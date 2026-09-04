import "dotenv/config";
import { prisma } from "../src/db";
import { orderPair } from "../src/lib/friends";
import { detectIcon } from "../src/lib/links";
import { utcDay, touchStreak } from "../src/lib/sessions";
import { recomputeArchetypes } from "../src/jobs/archetype";

// Dev seed — three dev-login accounts that are already friends, with two weeks of
// plausible activity so every screen (profile, friends, stats, projects, wall) has
// something to render on a fresh database. Idempotent: re-running upserts users and
// wipes + rebuilds their generated activity. Requires DEV_LOGIN_ENABLED=true to actually
// log in as them (POST /api/v1/auth/dev-login { username }).

const DAYS = 14;
const DAY_MS = 86_400_000;

const USERS = [
  {
    username: "ada",
    displayName: "Ada Lovelace",
    bio: "Shipping small tools with big agents. Mostly Claude Code, occasionally Cursor when I want autocomplete.",
    links: [
      { url: "https://github.com/ada", label: "GitHub" },
      { url: "https://x.com/ada", label: "X" },
      { url: "https://ada.dev", label: "Site" },
    ],
    tools: [
      { tool: "claude-code", model: "claude-sonnet-4.5", weight: 0.7 },
      { tool: "cursor", model: "gpt-4.1", weight: 0.3 },
    ],
    commitsPerDay: 6,
    projects: [
      { name: "neon-app", description: "Realtime dashboard for a friend's bakery. React + Express + a lot of vibes.", repoUrl: "https://github.com/ada/neon-app", liveUrl: "https://neon.ada.dev" },
      { name: "prompt-ledger", description: "Tracks how many tokens each prompt template burns. Ironic, I know.", repoUrl: "https://github.com/ada/prompt-ledger" },
    ],
  },
  {
    username: "linus",
    displayName: "Linus T.",
    bio: "Long autonomous runs. I write the spec, the agent writes the code, I write the angry review.",
    links: [
      { url: "https://github.com/linus", label: "GitHub" },
      { url: "https://www.youtube.com/@linus", label: "YouTube" },
    ],
    tools: [
      { tool: "codex", model: "gpt-5-codex", weight: 0.6 },
      { tool: "claude-code", model: "claude-opus-4.1", weight: 0.4 },
    ],
    commitsPerDay: 1,
    projects: [
      { name: "kernel-sim", description: "A toy scheduler simulator. Teaches you why your build is slow.", repoUrl: "https://github.com/linus/kernel-sim" },
    ],
  },
  {
    username: "grace",
    displayName: "Grace Hopper",
    bio: "Bugs are just moths. Quad-code + Gemini for most things, Claude for the hard ones.",
    links: [
      { url: "https://github.com/grace", label: "GitHub" },
      { url: "https://www.linkedin.com/in/grace", label: "LinkedIn" },
      { url: "https://discord.gg/vibehub", label: "Discord" },
    ],
    tools: [
      { tool: "quadcode", model: "gemini-2.5-pro", weight: 0.5 },
      { tool: "claude-code", model: "claude-sonnet-4.5", weight: 0.5 },
    ],
    commitsPerDay: 3,
    projects: [
      { name: "cobol-to-ts", description: "Migrates COBOL copybooks to TypeScript types. Yes, really.", repoUrl: "https://github.com/grace/cobol-to-ts", liveUrl: "https://cobol.grace.dev" },
      { name: "moth-catcher", description: "Flaky-test detector for CI. Names every flake after a moth species." },
    ],
  },
];

const WALL: Array<[wallOwner: string, author: string, body: string]> = [
  ["ada", "linus", "neon-app is the most over-engineered bakery dashboard I've ever seen and I love it."],
  ["ada", "grace", "Saw you hit a 9-day streak — go outside 😄"],
  ["linus", "ada", "Your review comments are longer than the diffs. Never change."],
  ["grace", "linus", "cobol-to-ts saved me a weekend. Owe you a coffee."],
];

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Deterministic pseudo-random so re-seeding produces the same numbers.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

async function main() {
  const now = new Date();
  const today = utcDay(now);
  // Nothing seeded may sit in the future: a closed session that "ends" three hours from
  // now reads as a live session in presence and as a stale timestamp in the tracker
  // panel (seen live: ada at 16:43Z while it was 13:32Z). Every startedAt/endedAt/
  // lastHeartbeatAt below is clamped to this — one minute in the past, so the sweep
  // and presence math never see a negative age either.
  const latest = new Date(now.getTime() - 60_000);
  const random = rng(42);

  const created = new Map<string, string>();

  for (const spec of USERS) {
    const user = await prisma.user.upsert({
      where: { username: spec.username },
      create: { username: spec.username, displayName: spec.displayName, bio: spec.bio, isDevAccount: true },
      update: { displayName: spec.displayName, bio: spec.bio, isDevAccount: true },
    });
    created.set(spec.username, user.id);

    // Reset generated content so the seed is idempotent.
    await prisma.$transaction([
      prisma.externalLink.deleteMany({ where: { userId: user.id } }),
      prisma.activityEvent.deleteMany({ where: { userId: user.id } }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
      prisma.dailyStat.deleteMany({ where: { userId: user.id } }),
      prisma.githubCommitDay.deleteMany({ where: { userId: user.id } }),
      prisma.userStreak.deleteMany({ where: { userId: user.id } }),
      prisma.like.deleteMany({ where: { userId: user.id } }),
      prisma.project.deleteMany({ where: { ownerId: user.id } }),
      prisma.wallComment.deleteMany({ where: { OR: [{ wallOwnerId: user.id }, { authorId: user.id }] } }),
    ]);

    await prisma.externalLink.createMany({
      data: spec.links.map((l, i) => ({ userId: user.id, url: l.url, label: l.label, icon: detectIcon(l.url), order: i })),
    });

    for (const p of spec.projects) {
      await prisma.project.create({ data: { ownerId: user.id, slug: slugify(p.name), ...p } });
    }

    // Two weeks of closed sessions folded into DailyStat + commit days + streak.
    for (let d = DAYS - 1; d >= 0; d--) {
      const day = new Date(today.getTime() - d * DAY_MS);
      const isRestDay = d === 5 || (d === 9 && spec.username === "linus"); // gaps make streaks interesting
      if (isRestDay) continue;

      for (const t of spec.tools) {
        let minutes = Math.round((30 + random() * 150) * t.weight);
        if (minutes < 5) continue;
        let startedAt = new Date(day.getTime() + (9 + random() * 8) * 3_600_000);
        let endedAt = new Date(startedAt.getTime() + minutes * 60_000);
        if (endedAt > latest) {
          // Today's sessions must already be over. End it a minute ago and keep as much
          // of its duration as fits between the start of the day and now; drop it if
          // that leaves nothing worth a row. rng order is unchanged either way.
          endedAt = latest;
          startedAt = new Date(Math.max(day.getTime(), latest.getTime() - minutes * 60_000));
          minutes = Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000);
          if (minutes < 5) continue;
        }
        const tokensInput = Math.round(minutes * (400 + random() * 600));
        const tokensOutput = Math.round(tokensInput * (spec.username === "linus" ? 3.5 + random() : 0.8 + random()));

        await prisma.session.create({
          data: {
            userId: user.id,
            projectAlias: spec.projects[Math.floor(random() * spec.projects.length)].name,
            tool: t.tool,
            model: t.model,
            status: "ENDED",
            startedAt,
            lastHeartbeatAt: endedAt,
            endedAt,
            tokensInput,
            tokensOutput,
          },
        });
        await prisma.dailyStat.upsert({
          where: { userId_date_model_tool: { userId: user.id, date: day, model: t.model, tool: t.tool } },
          create: { userId: user.id, date: day, model: t.model, tool: t.tool, tokensInput, tokensOutput, activeSeconds: minutes * 60 },
          update: { tokensInput: { increment: tokensInput }, tokensOutput: { increment: tokensOutput }, activeSeconds: { increment: minutes * 60 } },
        });
      }

      const commits = Math.max(0, Math.round(spec.commitsPerDay * (0.5 + random())));
      if (commits > 0) {
        await prisma.githubCommitDay.create({ data: { userId: user.id, date: day, commitCount: commits } });
      }
      await touchStreak(user.id, day);
    }
  }

  // Everyone is friends with everyone, with staggered "since" dates.
  const names = USERS.map((u) => u.username);
  let sinceOffset = 40;
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const pair = orderPair(created.get(names[i])!, created.get(names[j])!);
      const since = new Date(now.getTime() - sinceOffset * DAY_MS);
      sinceOffset += 37;
      await prisma.friendship.upsert({ where: { userAId_userBId: pair }, create: { ...pair, since }, update: { since } });
    }
  }

  for (const [owner, author, body] of WALL) {
    await prisma.wallComment.create({
      data: {
        wallOwnerId: created.get(owner)!,
        authorId: created.get(author)!,
        body,
        createdAt: new Date(now.getTime() - Math.round(random() * 6 * DAY_MS)),
      },
    });
  }

  // A few likes so counters aren't all zero.
  const projects = await prisma.project.findMany();
  for (const project of projects) {
    for (const username of names) {
      const userId = created.get(username)!;
      if (userId === project.ownerId || random() < 0.4) continue;
      await prisma.$transaction([
        prisma.like.create({ data: { projectId: project.id, userId } }),
        prisma.project.update({ where: { id: project.id }, data: { likeCount: { increment: 1 } } }),
      ]);
    }
  }

  // Linus is "coding right now" so the friends list shows a live status immediately
  // (last beat a minute ago → "active" for another minute, then idle, then offline
  // per lib/sessions.ts — never a heartbeat from the future).
  await prisma.session.create({
    data: {
      userId: created.get("linus")!,
      projectAlias: "kernel-sim",
      tool: "codex",
      model: "gpt-5-codex",
      status: "ACTIVE",
      startedAt: new Date(latest.getTime() - 47 * 60_000),
      lastHeartbeatAt: latest,
      tokensInput: 18_400,
      tokensOutput: 61_200,
    },
  });

  await recomputeArchetypes(now);

  const summary = await prisma.user.findMany({
    where: { username: { in: names } },
    select: { username: true, archetype: true },
  });
  console.log("seeded:", summary.map((u) => `${u.username} (${u.archetype})`).join(", "));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
