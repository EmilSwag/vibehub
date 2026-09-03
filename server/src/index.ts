import "dotenv/config";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { env } from "./env";
import { errorHandler } from "./lib/http-error";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import friendsRoutes from "./routes/friends";
import wallRoutes from "./routes/wall";
import projectsRoutes from "./routes/projects";
import statsRoutes from "./routes/stats";
import presenceRoutes from "./routes/presence";
import trackerRoutes from "./routes/tracker";
import { attachWebSocketServer } from "./ws";
import { startSessionRollupJob } from "./jobs/session-rollup";
import { startArchetypeJob } from "./jobs/archetype";

// Composition root. Contract every route/WS message follows: ../docs/ARCHITECTURE.md §5.
// Build order that produced this file: ../docs/BUILD_PLAN.md §4.

const app = express();

// Railway (and any reverse proxy) terminates TLS — trust X-Forwarded-* so req.protocol
// is "https" for avatar URLs and the session cookie can be marked Secure in production.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

// CORS — credentials mode, so the origin must be echoed exactly (no wildcard). Accepts a
// comma-separated allowlist to cover local dev + the deployed web origin at once.
const allowedOrigins = new Set(
  env.corsOrigin
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// Health + capability probe. The web login page reads `auth` to decide which sign-in
// methods to render (GitHub OAuth needs GITHUB_CLIENT_ID; username login needs
// DEV_LOGIN_ENABLED=true), so an instance without OAuth configured is still usable.
app.get("/api/v1/health", (_req, res) => {
  res.json({
    ok: true,
    service: "vibehub-server",
    provider: env.databaseProvider,
    auth: { github: Boolean(env.githubClientId), devLogin: env.devLoginEnabled },
  });
});

// Avatar files written by routes/users.ts (local disk — fine for a small friend group;
// swap for object storage before this grows).
app.use(
  "/uploads",
  express.static(path.join(process.cwd(), "uploads"), { maxAge: "7d", immutable: true, fallthrough: false })
);

app.use("/api/v1/auth", authRoutes); // routes/auth.ts defines /github, /dev-login, /logout, /me
app.use("/api/v1", usersRoutes);
app.use("/api/v1", friendsRoutes);
app.use("/api/v1", wallRoutes);
app.use("/api/v1", projectsRoutes);
app.use("/api/v1", statsRoutes);
app.use("/api/v1", presenceRoutes);
app.use("/api/v1", trackerRoutes);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(errorHandler);

const httpServer = createServer(app);
attachWebSocketServer(httpServer);

httpServer.listen(env.port, () => {
  console.log(`vibehub-server listening on :${env.port} (db=${env.databaseProvider}, dev-login=${env.devLoginEnabled})`);
  startSessionRollupJob();
  startArchetypeJob();
});
