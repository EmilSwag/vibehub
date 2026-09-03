-- Onboarding roles became multi-select. Same TEXT column, now a comma-separated
-- list (e.g. "developer,designer"); existing single values stay valid as-is.
ALTER TABLE "users" RENAME COLUMN "role" TO "roles";
