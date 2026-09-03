#!/usr/bin/env node
/**
 * Tracker smoke probe: runs two heartbeat ticks against an in-process mock API
 * and prints every payload the tracker sent plus the local status file.
 *
 *   node scripts/probe-tracker-tick.js
 *
 * Build the tracker first (`npm run build --workspace tracker`).
 */
const http = require("node:http");
const path = require("node:path");

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

server.listen(0, async () => {
  const { port } = server.address();
  const config = {
    apiUrl: `http://127.0.0.1:${port}`,
    deviceToken: "probe-token",
    projectAliases: {},
    idleThresholdMs: 5 * 60 * 1000,
  };
  const state = createLoopState(config);

  await tick(config, state);
  await new Promise((r) => setTimeout(r, 1500));
  await tick(config, state);

  for (const r of received) {
    const b = r.body;
    console.log(
      `${r.url}  auth=${r.auth}  ${b.eventType.padEnd(13)} alias=${b.projectAlias}  tool=${b.tool}  model=${b.model}  tokens=${b.tokensInputDelta ?? "-"}/${b.tokensOutputDelta ?? "-"}`
    );
  }
  if (received.length === 0) console.log("(no payloads — no AI tool detected as active on this machine)");

  const read = statusFile.readStatus || statusFile.readStatusFile;
  if (typeof read === "function") console.log("status file:", JSON.stringify(read()));

  server.close();
  process.exit(0);
});
