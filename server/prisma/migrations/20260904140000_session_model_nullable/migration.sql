-- A session's `model` is only knowable for log-backed tools (Claude Code, Codex);
-- presence-only tools (Cursor, Quadcode, Grok, ChatGPT app) have no model, so the
-- heartbeat now sends null instead of the literal "unknown". Widen the column to
-- allow NULL. Existing "unknown" rows stay valid and are mapped to null at read time
-- (presenceFor). Non-destructive: dropping NOT NULL never rewrites existing data.
ALTER TABLE "sessions" ALTER COLUMN "model" DROP NOT NULL;
