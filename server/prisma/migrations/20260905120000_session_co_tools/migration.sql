-- Round 6 multi-tool presence: the latest tools[] the tracker reported alongside a
-- session's heartbeat — every tool it could see open at that moment, primary first,
-- stored as [{tool, model, projectAlias}]. Presence only; hours and tokens still
-- accrue to the session's own tool/model, so nothing about accounting changes.
--
-- Additive and nullable: sessions written by a tracker that predates tools[] keep
-- NULL, which presence readers surface as just [activity]. No data rewrite.
-- IF NOT EXISTS so a hand-applied column on an existing database is a no-op.

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "coTools" JSONB;
