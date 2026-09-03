import { PrismaClient } from "@prisma/client";
import { env } from "./env";

// Prisma cannot target two providers from one schema at generate time (see
// docs/BUILD_PLAN.md §4 "SQLite dev fallback"), so the Postgres schema
// (prisma/schema.prisma) and the SQLite mirror (prisma/schema.sqlite.prisma) each
// generate their own client. The Postgres client (default `@prisma/client` output)
// is used as the canonical TypeScript type for the whole codebase; at runtime we
// swap in the SQLite-generated client when DATABASE_PROVIDER=sqlite. The two clients
// are structurally identical except enum columns (real enums vs plain strings), which
// is exactly the divergence docs/ARCHITECTURE.md §2.15 calls out as validated at the
// application layer instead — so the cast below is safe as long as both schemas are
// kept in lockstep by hand, per BUILD_PLAN.md §4.
const SqliteClient =
  env.databaseProvider === "sqlite"
    ? (require("../generated/sqlite-client") as { PrismaClient: typeof PrismaClient }).PrismaClient
    : PrismaClient;

export const prisma: PrismaClient = new SqliteClient();
