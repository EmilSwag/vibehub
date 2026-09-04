-- GitHub App user-to-server access tokens expire (~8h). Persist the refresh token
-- (encrypted at rest, same as the access token) plus both expiries so the server can
-- silently mint a fresh access token instead of forcing the user to sign in again.
-- Additive + nullable: existing rows keep their (now-expired) access token and null
-- refresh fields, so they resolve to "reconnect GitHub once" until re-authorized.
ALTER TABLE "users" ADD COLUMN "githubRefreshToken" TEXT;
ALTER TABLE "users" ADD COLUMN "githubTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "githubRefreshTokenExpiresAt" TIMESTAMP(3);
