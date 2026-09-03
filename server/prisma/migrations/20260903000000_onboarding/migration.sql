-- Onboarding: self-selected role card + completion timestamp.
-- role is a plain TEXT (designer | developer | gamedev | creator | founder), validated
-- in the app layer so the SQLite dev schema stays a byte-for-byte mirror.
ALTER TABLE "users" ADD COLUMN "role" TEXT;
ALTER TABLE "users" ADD COLUMN "onboardedAt" TIMESTAMP(3);
