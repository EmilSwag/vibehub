-- A tracker daemon that keeps heartbeating with a token the user already revoked is
-- invisible to the UI (every request is a 401 and nothing is written). Record when a
-- revoked token was last presented so /users/me/tracker can say "a tracker on your
-- machine still uses an old token" instead of a bare Offline. Additive + nullable.
ALTER TABLE "tracker_tokens" ADD COLUMN "lastRejectedAt" TIMESTAMP(3);
