-- QA fix R2 (meta/plans/vibehub-qa-fix.md): cache counters beside fresh input.
-- Additive with defaults: existing rows read as "no cache counted".
ALTER TABLE "sessions" ADD COLUMN "tokensCacheRead" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "sessions" ADD COLUMN "tokensCacheWrite" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "daily_stats" ADD COLUMN "tokensCacheRead" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "daily_stats" ADD COLUMN "tokensCacheWrite" INTEGER NOT NULL DEFAULT 0;
