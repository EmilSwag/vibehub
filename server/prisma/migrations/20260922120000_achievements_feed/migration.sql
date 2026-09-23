-- Honest achievements + real Vibe Feed (meta/plans/vibehub-honest-achievements-feed.md).
--
-- sessions.tzOffsetMinutes: minutes to ADD to UTC to get the tracker host's local time
-- (= -Date#getTimezoneOffset()), sent by the tracker on session_start and every
-- heartbeat. Nullable and additive: rows written by an older tracker stay NULL and are
-- ignored by the local-time achievement rule (Night Owl) rather than guessed.
-- IF NOT EXISTS so a hand-applied column on an existing database is a no-op.
--
-- user_achievements: one row per badge a user has earned, inserted the first time its
-- rule evaluates true against real rows (lib/achievements.ts syncAchievements). Never
-- deleted; unlockedAt is what the feed and the unlock toast report.
--
-- feed_reactions: a viewer's "respect" / "flame" on one feed event, keyed by the event's
-- stable target id. Toggled by POST /feed/reactions; counts folded by one groupBy.

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "tzOffsetMinutes" INTEGER;

-- CreateTable
CREATE TABLE "user_achievements" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_reactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_achievements_userId_achievementId_key" ON "user_achievements"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "user_achievements_unlockedAt_idx" ON "user_achievements"("unlockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "feed_reactions_userId_target_kind_key" ON "feed_reactions"("userId", "target", "kind");

-- CreateIndex
CREATE INDEX "feed_reactions_target_idx" ON "feed_reactions"("target");

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
