#!/usr/bin/env node
/**
 * Tracker smoke probe: runs two heartbeat ticks against an in-process mock API
 * and prints every payload the tracker sent (including the per-source `usage`
 * attribution of heartbeat v2) plus the local status file.
 *
 *   node scripts/probe-tracker-tick.js
 *
 * Build the tracker first (`npm run build --workspace tracker`).
 *
 * Safety: the tracker's ~/.vibehub (config/status/queue) is redirected to a
 * throwaway temp dir BEFORE dist is loaded, so this never touches the real
 * tracker state — but it still tails this machine's real Claude Code / Codex
 * logs (CLAUDE_CONFIG_DIR / CODEX_HOME default to the real home), which is the
 * point of the probe. Only model ids, token counts and a folder name are printed.
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const realHome = os.homedir();
process.env.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(realHome, ".claude");
process.env.CODEX_HOME = process.env.CODEX_HOME || path.join(realHome, ".codex");
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibehub-probe-home-"));
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome; // os.homedir() reads this on Windows

const dist = path.join(__dirname, "..", "tracker", "dist");
const { tick, createLoopState } = require(path.join(dist, "heartbeat.js"));
const statusFile = require(path.join(dist, "statusFile.js"));

const received = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || "{}") });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
  });
});

const fmtUsage = (usage) =>
  Array.isArray(usage)
    ? usage.length
      ? usage.map((u) => `${u.tool}/${u.model ?? "null"}:${u.tokensInputDelta}/${u.tokensOutputDelta}`).join(" ")
      : "[]"
    : "(absent)";

server.listen(0, async () => {
  const { port } = server.address();
  const config = {
    apiUrl: `http://127.0.0.1:${port}`,
    deviceToken: "probe-token",
    projectAliases: {},
    idleThresholdMs: 5 * 60 * 1000,
  };
  const state = createLoopState(config);

  // Tick duration matters: a tick slower than the 30 s interval used to stack up
  // (tasklist /v took ~54 s here); the loop now skips overlapping ticks instead.
  const timed = async (label) => {
    const t0 = Date.now();
    await tick(config, state);
    console.log(`${label}: ${Date.now() - t0} ms`);
  };
  await timed("tick 1 (prime)");
  await new Promise((r) => setTimeout(r, 1500));
  await timed("tick 2");

  for (const r of received) {
    const b = r.body;
    console.log(
      `${r.url}  auth=${r.auth}  ${b.eventType.padEnd(13)} alias=${b.projectAlias}  tool=${b.tool}  model=${b.model}  tokens=${b.tokensInputDelta ?? "-"}/${b.tokensOutputDelta ?? "-"}  usage=${fmtUsage(b.usage)}`
    );
  }
  if (received.length === 0) console.log("(no payloads — no AI tool detected as active on this machine)");

  const read = statusFile.readStatus || statusFile.readStatusFile;
  if (typeof read === "function") console.log("status file:", JSON.stringify(read()));

  server.close();
  try {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
  process.exit(0);
});
