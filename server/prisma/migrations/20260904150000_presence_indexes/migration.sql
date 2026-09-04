-- Presence and the tracker-status panel read the freshest Session per user on every
-- poll (presenceFor / GET /users/me/tracker / the rollup sweep: userId +
-- lastHeartbeatAt DESC) and scan a user's newest ActivityEvents by occurredAt for
-- `sources`. Both were full table scans filtered by userId. Additive, no data
-- rewrite; IF NOT EXISTS so a hand-applied index on an existing database is a no-op.
-- Names follow Prisma's <table>_<col>_<col>_idx convention so `prisma migrate diff`
-- sees the schema and the database as identical.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sessions_userId_lastHeartbeatAt_idx" ON "sessions"("userId", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "activity_events_userId_occurredAt_idx" ON "activity_events"("userId", "occurredAt");
