import { env } from "../env";

// ActivityEvent.payload is `Json` on Postgres but a plain `String` on the SQLite
// mirror (SQLite has no native Json type — ARCHITECTURE.md §2.15). Since src/db.ts
// swaps in whichever generated client matches DATABASE_PROVIDER at runtime, the
// value shape passed to Prisma must match that client's schema, not just the
// Postgres type this codebase compiles against. This is the one field where the two
// schemas diverge in a way that isn't just "enum vs string", so it needs an explicit
// runtime branch.
export function toPayloadValue(payload: Record<string, unknown>): unknown {
  return env.databaseProvider === "sqlite" ? JSON.stringify(payload) : payload;
}

export function fromPayloadValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (value as Record<string, unknown> | null) ?? {};
}
