// FC4 (mac app): `login --token-stdin` - the token is read from stdin, never from argv
// (visible to every local process via `ps`) and never from the environment. The VibeHub
// app greps stdout for "Logged in as " to decide success, so that line is a contract.
//
// SAFETY: HOME/USERPROFILE are redirected to a throwaway directory BEFORE any tracker
// module is required, and every child is spawned with that same HOME. The only network
// activity is a loopback mock of /api/v1/tracker/verify.

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";

const tempRoot = resolve(__dirname, "../../../.temp/vibehub-ai-only");
mkdirSync(tempRoot, { recursive: true });
const sandbox = mkdtempSync(join(tempRoot, "login-stdin-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.HOMEDRIVE = sandbox.slice(0, 2);
process.env.HOMEPATH = sandbox.slice(2);

const { CONFIG_DIR, CONFIG_PATH } = require("../src/paths") as typeof import("../src/paths");
if (!CONFIG_DIR.startsWith(sandbox)) {
  throw new Error(`refusing to run: the tracker resolves ${CONFIG_DIR}, not the sandbox ${sandbox}`);
}

const ENTRY = resolve(__dirname, "../src/index.ts");
const TRACKER_ROOT = resolve(__dirname, "..");
const childEnv = { ...process.env, HOME: sandbox, USERPROFILE: sandbox, HOMEDRIVE: sandbox.slice(0, 2), HOMEPATH: sandbox.slice(2) };
const TOKEN = "vh_stdin_test_token_do_not_use_0123456789";

interface Result { code: number | null; stdout: string; stderr: string }
function login(args: string[], stdin: string | null): Promise<Result> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ["--import", "tsx", ENTRY, "login", ...args], {
      cwd: TRACKER_ROOT, env: childEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf8"); });
    child.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
    child.on("exit", (code) => resolveRun({ code, stdout, stderr }));
    child.on("error", () => resolveRun({ code: null, stdout, stderr }));
    if (stdin !== null) child.stdin.write(stdin);
    child.stdin.end();
  });
}

let apiUrl = "";
const server = createServer((req, res) => {
  const auth = req.headers.authorization ?? "";
  if (req.url === "/api/v1/tracker/verify" && auth === `Bearer ${TOKEN}`) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ username: "qa-stdin" }));
    return;
  }
  res.writeHead(401, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Invalid or revoked tracker token" }));
});

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  try { rmSync(sandbox, { recursive: true, force: true }); } catch {}
});

const resetConfig = (): void => { try { rmSync(CONFIG_PATH, { force: true }); } catch {} };

describe("login --token-stdin", () => {
  it("reads one line from stdin, verifies it, writes config and prints the success line", { timeout: 60_000 }, async () => {
    resetConfig();
    const r = await login(["--token-stdin", "--api-url", apiUrl], `${TOKEN}\n`);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^Logged in as @qa-stdin\./m, "the mac app greps for this line");
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as { deviceToken: string; apiUrl: string };
    assert.equal(config.deviceToken, TOKEN);
    assert.equal(config.apiUrl, apiUrl);
    assert.ok(!r.stdout.includes(TOKEN) && !r.stderr.includes(TOKEN), "the token must never be echoed");
  });

  it("trims CRLF and ignores anything after the first line", { timeout: 60_000 }, async () => {
    resetConfig();
    const r = await login(["--token-stdin", "--api-url", apiUrl], `  ${TOKEN}\r\nsecond line is ignored\n`);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal((JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as { deviceToken: string }).deviceToken, TOKEN);
  });

  it("refuses an empty stdin and writes nothing", { timeout: 60_000 }, async () => {
    resetConfig();
    const r = await login(["--token-stdin", "--api-url", apiUrl], "");
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /Login failed/);
    assert.ok(!existsSync(CONFIG_PATH), "no config on failure");
  });

  it("refuses a token given both as argument and on stdin", { timeout: 60_000 }, async () => {
    resetConfig();
    const r = await login(["--token-stdin", "--api-url", apiUrl, TOKEN], `${TOKEN}\n`);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /not both/);
    assert.ok(!existsSync(CONFIG_PATH));
    assert.ok(!r.stdout.includes(TOKEN) && !r.stderr.includes(TOKEN), "the token must never be echoed");
  });

  it("still rejects a server-rejected token read from stdin", { timeout: 60_000 }, async () => {
    resetConfig();
    const r = await login(["--token-stdin", "--api-url", apiUrl], "vh_wrong_token_0123456789abcdef\n");
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /rejected by the server/);
    assert.ok(!existsSync(CONFIG_PATH));
  });

  it("keeps the argv form for connect.sh", { timeout: 60_000 }, async () => {
    resetConfig();
    const r = await login([TOKEN, "--api-url", apiUrl], null);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^Logged in as @qa-stdin\./m);
  });
});
