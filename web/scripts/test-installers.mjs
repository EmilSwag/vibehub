#!/usr/bin/env node
// Regression tests for the setup-only tracker installers.
//
// Contract under test (meta/plans/vibehub-tracker-explicit-start.md, and the
// review fixes in meta/plans/tracker-installer-review-fixes.md): installing the
// tracker must NEVER start, stop, restart or autostart the daemon. Installing,
// and granting permission to run a background tracker, are two separate acts;
// public/tracker/install.{sh,ps1} only perform the first.
//
// Nothing real is ever launched. The "tracker" these tests download is a stub
// that records its own argv and exits; the installers run against a throwaway
// HOME and a throwaway localhost origin. Every run aborts unless the sandboxed
// HOME demonstrably took effect, so a developer's real ~/.vibehub — and any
// tracker they actually have running — is never touched.
//
//   node scripts/test-installers.mjs

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync, chmodSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const TRACKER_DIR = join(webRoot, "public", "tracker");
const SH = join(TRACKER_DIR, "install.sh");
const PS1 = join(TRACKER_DIR, "install.ps1");
const TOKEN = "vbh_sandbox_token_do_not_use";

let failures = 0;
let passes = 0;
const blockers = [];
const check = (ok, label, detail) => {
  if (ok) {
    passes += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`);
  }
};
const section = (name) => console.log(`\n${name}`);

// ---------------------------------------------------------------------------
// 1. Source pattern scan.
//
// HONEST SCOPE: this is a textual grep over the two files, not a semantic
// analysis. It catches the constructs spelled out literally — which is how a
// "just start it for the user" convenience would realistically get reintroduced
// — and it is the only check that sees every branch at once, including branches
// the sandbox runs never enter. It does NOT catch an indirect or obfuscated
// spawn (a command assembled from variables, eval/iex of a fetched string, a
// helper invoked by name). Those are covered, for the paths they touch, by the
// sandbox runs below; outside those paths they are covered by review, not by
// this script. Comments are stripped first: both scripts describe in prose what
// they refuse to do ("no nohup, no &"), and that prose must not read as a hit.
// ---------------------------------------------------------------------------

const stripComments = (src) =>
  src
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

// Executing the tracker with a lifecycle subcommand. Anchored at line start so
// the quoted commands the installers *print* for the user (indented, prefixed
// with "start:" / "stop:") are not mistaken for the installer running them.
const LIFECYCLE_SH = /^\s*(&\s*)?node\s+"?\$\{?BIN\}?"?\s+(start|stop|restart|run-loop)\b/m;
const LIFECYCLE_PS = /^\s*(&\s*)?node\s+"?\$\{?Bin\}?"?\s+(start|stop|restart|run-loop)\b/m;

const BACKGROUND_SH = [
  [/\bnohup\b/, "nohup"],
  [/\bdisown\b/, "disown"],
  [/\bsetsid\b/, "setsid"],
  [/&\s*$/m, "trailing & (background job)"],
  [/\blaunchctl\b/, "launchctl (launchd autostart)"],
  [/\bsystemctl\b/, "systemctl (systemd autostart)"],
  [/\bcrontab\b/, "crontab (cron autostart)"],
  [/LaunchAgents/, "LaunchAgents plist"],
  [/\bscreen\s+-d\b|\btmux\s+new\b/, "screen/tmux detach"],
];
const BACKGROUND_PS = [
  [/\bStart-Process\b/, "Start-Process"],
  [/\bStart-Job\b/, "Start-Job"],
  [/\bStart-ThreadJob\b/, "Start-ThreadJob"],
  [/\bschtasks\b/i, "schtasks (Task Scheduler autostart)"],
  [/\bRegister-ScheduledTask\b/i, "Register-ScheduledTask"],
  [/\bNew-ScheduledTask/i, "New-ScheduledTask*"],
  [/CurrentVersion\\+Run/i, "HKCU Run key autostart"],
  [/-WindowStyle\s+Hidden/i, "hidden window spawn"],
  [/\bWScript\.Shell\b/i, "WScript.Shell"],
];

// The success line, on its own line — the one thing a completed install prints that a
// failed one must not (round 9, job 1B). Anchored, so it also proves the line stands
// alone in the output rather than being buried in a sentence.
const SUCCESS = /^OK Installed\.$/m;
// Source form: install.sh carries the literal line inside its heredoc, but install.ps1
// wraps it in `Write-Host "..."`, where the line anchors cannot apply. Same string,
// unanchored, for the textual scan only.
const SUCCESS_SRC = /OK Installed\./;
// What a start actually costs, said once. Both installers now put it on a single line,
// so source and runtime take the same pattern.
const BACKGROUND_NOTE = /start runs in the background until you stop it\./;

section("source pattern scan (textual grep over both files — see scope note in source)");
for (const [file, label, lifecycle, patterns] of [
  [SH, "install.sh", LIFECYCLE_SH, BACKGROUND_SH],
  [PS1, "install.ps1", LIFECYCLE_PS, BACKGROUND_PS],
]) {
  const code = stripComments(readFileSync(file, "utf8"));
  const hit = code.match(lifecycle);
  check(!hit, `${label}: never invokes the tracker's start/stop/run-loop`, hit && `found: ${hit[0].trim()}`);
  for (const [re, name] of patterns) {
    const m = code.match(re);
    check(!m, `${label}: no ${name}`, m && `found: ${m[0].trim()}`);
  }
  check(SUCCESS_SRC.test(code), `${label}: prints the success line`);
  check(!/Nothing is being tracked yet|installed-not-running/i.test(code), `${label}: makes no claim about whether anything is being tracked`);
  check(
    BACKGROUND_NOTE.test(code.replace(/\s+/g, " ")),
    `${label}: says a start runs in the background until stopped`,
  );
  for (const cmd of ["start", "status", "stop"]) {
    check(new RegExp(`${cmd}:\\s+node `).test(code), `${label}: quotes the ${cmd} command for the user`);
  }
}

// ---------------------------------------------------------------------------
// 1b. install.ps1 encoding and first output (round 10, W1/W2).
//
// Both of these are invisible in a diff and both broke a real install:
//   - the file shipped with a UTF-8 BOM, and the documented way to run it is
//     `irm … | iex`, which hands PowerShell a string — the BOM arrives welded to
//     the first token and every install opened with a red parser error.
//   - nothing was printed until the download finished, so an agent terminal sat
//     silent for ~6 s with no way to tell setup from a hang.
// ---------------------------------------------------------------------------

section("install.ps1 — encoding and first output");
{
  const raw = readFileSync(PS1);
  check(!(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf), "install.ps1: no UTF-8 BOM (`irm | iex` parses the first token)");
  const nonAscii = raw.findIndex((b) => b > 0x7f);
  check(
    nonAscii === -1,
    "install.ps1: pure ASCII (a BOM-less .ps1 is decoded through PS 5.1's codepage)",
    nonAscii === -1 ? null : `byte 0x${raw[nonAscii].toString(16)} at offset ${nonAscii}`,
  );
  // "First statement" is the whole point: anything above it runs while the console
  // is still blank.
  const firstStatement = readFileSync(PS1, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "" && !l.startsWith("#"));
  check(/^Write-Host\b/.test(firstStatement ?? ""), "install.ps1: the very first statement prints something", `first statement: ${JSON.stringify(firstStatement)}`);
}

// ---------------------------------------------------------------------------
// 2. Sandbox runs.
// ---------------------------------------------------------------------------

const PADDING = "x".repeat(1200);
const stubSource = () => [
  "#!/usr/bin/env node",
  '"use strict";',
  "// TEST STUB for vibehub-tracker.cjs. Records argv, spawns nothing, exits.",
  'const fs = require("fs");',
  'fs.appendFileSync(process.env.VIBEHUB_TEST_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");',
  "const cmd = process.argv[2];",
  'if (cmd === "login") {',
  '  if (process.env.VIBEHUB_TEST_REJECT === "1") {',
  '    console.error("Login failed: token rejected by the server (stub).");',
  "    process.exit(1);",
  "  }",
  '  console.log("Logged in as @stub.");',
  "  process.exit(0);",
  "}",
  'console.error("STUB SAW LIFECYCLE COMMAND: " + cmd);',
  "process.exit(9);",
  "// padding so the installers' size sanity check treats this as a real download",
  `// ${PADDING}`,
  "",
].join("\n");

let serveMode = "tracker";
const server = createServer((req, res) => {
  if (!req.url.endsWith("/tracker/vibehub-tracker.cjs")) {
    res.writeHead(404).end("no");
    return;
  }
  if (serveMode === "http-error") {
    res.writeHead(503, { "content-type": "text/plain" }).end("service unavailable");
    return;
  }
  if (serveMode === "truncated") {
    res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html>");
    return;
  }
  res.writeHead(200, { "content-type": "application/javascript" }).end(stubSource());
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const scratch = [];
function freshSandbox({ spaced = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), spaced ? "vibehub installer test " : "vibehub-installer-test-"));
  scratch.push(home);
  mkdirSync(join(home, ".vibehub"), { recursive: true });
  // Stand-in for a tracker the user already has running. The installer must
  // leave it strictly alone.
  writeFileSync(join(home, ".vibehub", "tracker.pid"), "999999");
  return { home, log: join(home, "invocations.log") };
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const readLog = (log) =>
  existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

// Async on purpose: the stub tracker is served by an HTTP server living in this
// same process, so a blocking spawnSync would deadlock — curl would wait for a
// response the blocked event loop can never send.
const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    // opts.stdin defaults to "pipe" (left open) — every case above was written
    // against that. "ignore" hands the child a closed stdin; see runPs1ViaIex.
    const child = spawn(cmd, args, { env: opts.env, windowsHide: true, stdio: [opts.stdin ?? "pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 60_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ status: -1, stdout, stderr: `${stderr}${err}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: timedOut ? "timeout" : code, stdout, stderr });
    });
  });

const toPosix = async (winPath) => {
  const r = await run("bash", ["-c", `cygpath -u "${winPath}"`]);
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return winPath.replace(/\\/g, "/");
};

// --- Node shims, for the "no node" / "old node" branches ------------------
// PATHs that deliberately contain no Node. /usr/bin under Git Bash has the
// coreutils but no node; System32 likewise. Verified before use, below.
const SH_PATH_NO_NODE = "/usr/bin";
const PS_PATH_NO_NODE = "C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0";

function shimDir(kind) {
  const dir = mkdtempSync(join(tmpdir(), `vibehub-nodeshim-${kind}-`));
  scratch.push(dir);
  if (kind === "sh") {
    const p = join(dir, "node");
    writeFileSync(p, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "v16.20.0"; exit 0; fi\necho 16\nexit 0\n');
    chmodSync(p, 0o755);
  } else {
    writeFileSync(join(dir, "node.cmd"), "@echo off\r\necho v16.20.0\r\n");
  }
  return dir;
}

const bashOk = (await run("bash", ["--version"])).status === 0;
const pwshOk = process.platform === "win32" && (await run("powershell", ["-NoProfile", "-Command", "1"])).status === 0;

// --- Blocker probe: can we run a .ps1 FILE without weakening policy? -------
// The suite deliberately does not pass -ExecutionPolicy Bypass: that would be
// the harness doing the very thing the product refuses to do. If policy blocks
// script files, that is reported as a blocker and the run fails; it is not
// worked around.
async function ps1FileRunnable() {
  const probe = join(mkdtempSync(join(tmpdir(), "vibehub-policy-probe-")), "probe.ps1");
  scratch.push(dirname(probe));
  writeFileSync(probe, 'Write-Host -NoNewline "RAN-OK"\n');
  const r = await run("powershell", ["-NoProfile", "-File", probe]);
  return { ok: r.stdout.trim() === "RAN-OK", detail: `${(r.stderr || "").trim().slice(0, 300)}` };
}

function runSh({ home, log }, { token = TOKEN, reject = false, pathOverride = null } = {}) {
  return (async () => {
    const posixHome = await toPosix(home);
    const env = { ...process.env, HOME: posixHome, VIBEHUB_TEST_LOG: log, VIBEHUB_WEB_URL: ORIGIN, VIBEHUB_API_URL: ORIGIN };
    delete env.VIBEHUB_TOKEN;
    if (reject) env.VIBEHUB_TEST_REJECT = "1";
    // Guard: never run the installer unless HOME really points at the sandbox.
    const probe = (await run("bash", ["-c", 'printf %s "$HOME"'], { env })).stdout;
    if (probe !== posixHome) throw new Error(`sandbox HOME did not take effect (got ${probe}); refusing to run install.sh`);
    const script = await toPosix(SH);
    if (!pathOverride) {
      const args = [script];
      if (token) args.push(token);
      return run("bash", args, { env });
    }
    // PATH is set inside the shell so that spawning bash itself still resolves.
    const args = ["-c", 'export PATH="$1"; shift; exec bash "$@"', "wrapper", pathOverride, script];
    if (token) args.push(token);
    return run("bash", args, { env });
  })();
}

function ps1Env({ home, log }, { token = TOKEN, reject = false, pathOverride = null } = {}) {
  const env = {
    ...process.env,
    USERPROFILE: home,
    HOMEDRIVE: home.slice(0, 2),
    HOMEPATH: home.slice(2),
    // PowerShell writes its own caches (ModuleAnalysisCache, PSReadLine history) under
    // these. Left alone, the -Command cases drop a `Microsoft/Windows/PowerShell/`
    // tree into whatever the cwd happens to be — i.e. into the repo. Point them at the
    // throwaway HOME so the sandbox really does contain everything the run writes.
    LOCALAPPDATA: join(home, "AppData", "Local"),
    APPDATA: join(home, "AppData", "Roaming"),
    VIBEHUB_TEST_LOG: log,
    VIBEHUB_WEB_URL: ORIGIN,
    VIBEHUB_API_URL: ORIGIN,
  };
  delete env.VIBEHUB_TOKEN;
  if (token) env.VIBEHUB_TOKEN = token;
  if (reject) env.VIBEHUB_TEST_REJECT = "1";
  if (pathOverride) env.PATH = pathOverride;
  return env;
}

/** Guard: never run the installer unless $HOME really points at the sandbox. */
async function assertSandboxHome(env, home) {
  const probe = (await run("powershell", ["-NoProfile", "-Command", "Write-Host -NoNewline $HOME"], { env })).stdout;
  if (probe !== home) throw new Error(`sandbox HOME did not take effect (got ${probe}); refusing to run install.ps1`);
}

function runPs1(box, opts = {}) {
  return (async () => {
    const env = ps1Env(box, opts);
    await assertSandboxHome(env, box.home);
    // -NoProfile -File only. No -ExecutionPolicy flag, by design.
    return run("powershell", ["-NoProfile", "-File", PS1], { env });
  })();
}

/**
 * install.ps1 the way the connect sheet actually tells people to run it:
 * `irm <url>/tracker/install.ps1 | iex`.
 *
 * The decode is deliberate and load-bearing. Invoke-RestMethod hands PowerShell a
 * *string*, and a UTF-8 BOM survives that decode as a literal U+FEFF welded to the
 * first token. `Get-Content -Raw` would strip the BOM and make this test vacuous;
 * reading the bytes and running them through UTF8.GetString reproduces what the
 * network path produces, byte for byte.
 *
 * The error IDs are dumped afterwards because this machine class renders PowerShell
 * errors in the user's display language — the rendered text is not something a test
 * can match on. `FullyQualifiedErrorId` is not localised.
 */
function runPs1ViaIex(box, opts = {}) {
  return (async () => {
    const env = ps1Env(box, opts);
    await assertSandboxHome(env, box.home);
    const command = [
      `$src = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes('${PS1.replace(/'/g, "''")}'));`,
      "$Error.Clear();",
      "Invoke-Expression $src;",
      "foreach ($e in $Error) { [Console]::Error.WriteLine('VH_ERRID: ' + $e.FullyQualifiedErrorId) }",
    ].join(" ");
    // stdin closed, and that is not a detail. With a BOM, line 1 parses as a command
    // whose `(PowerShell)` argument launches a NESTED PowerShell; given an open stdin
    // pipe it waits for input forever, so the run times out with zero bytes on both
    // streams and every assertion below — including the CommandNotFoundException one —
    // passes vacuously on an empty string. A closed stdin gives the nested shell EOF,
    // which is what the real `irm | iex` run does (the round-10 measurement: exit 0 in
    // 7.2 s, install completes, red CommandNotFoundException first on stderr). Measured
    // here: open stdin -> 45 s timeout, 0 bytes; closed stdin -> the real failure.
    return run("powershell", ["-NoProfile", "-Command", command], { env, stdin: "ignore" });
  })();
}

const LIFECYCLE_CMDS = ["start", "stop", "restart", "run-loop"];
const AUTOSTART_ARTIFACTS = [/daemon\.log$/i, /stop\.request$/i, /LaunchAgents/i, /systemd/i, /\.plist$/i, /[/\\]Startup[/\\]/i, /\.lnk$/i];
const trackerBin = (home) => join(home, ".vibehub", "app", "vibehub-tracker.cjs");

function assertSetupOnly(label, box, res) {
  const log = readLog(box.log);
  const cmds = log.map((a) => a[0]);
  check(res.status === 0, `${label}: exits 0`, `status=${res.status} stderr=${(res.stderr || "").trim().slice(0, 300)}`);
  check(cmds.length === 1 && cmds[0] === "login", `${label}: the only tracker invocation is login`, `saw: ${JSON.stringify(cmds)}`);
  check(!cmds.some((c) => LIFECYCLE_CMDS.includes(c)), `${label}: never starts or stops a daemon`, `saw: ${JSON.stringify(cmds)}`);
  check(log[0]?.includes("--api-url"), `${label}: login validates against the server`);
  check(existsSync(trackerBin(box.home)), `${label}: tracker was downloaded`);
  check(readFileSync(join(box.home, ".vibehub", "tracker.pid"), "utf8") === "999999", `${label}: an already-running daemon is left untouched`);
  const stray = walk(box.home)
    .filter((f) => AUTOSTART_ARTIFACTS.some((re) => re.test(f)))
    .map((f) => relative(box.home, f));
  check(stray.length === 0, `${label}: no daemon/autostart artifacts written`, stray.join(", "));
  const out = `${res.stdout}`;
  check(SUCCESS.test(out), `${label}: prints the success line`, out.trim().slice(-300));
  check(!/Nothing is being tracked yet/i.test(out), `${label}: makes no claim about whether anything is being tracked`);
  check(BACKGROUND_NOTE.test(out.replace(/\s+/g, " ")), `${label}: says a start runs in the background until stopped`);
  check(!/is running|Connected: yes/.test(out), `${label}: never claims the tracker is running or connected`);
  check(!out.includes(TOKEN), `${label}: the token is never echoed back`);
}

function assertFailedHonestly(label, box, res, { expectDownload = null, expectLogin = false } = {}) {
  const cmds = readLog(box.log).map((a) => a[0]);
  check(res.status !== 0, `${label}: exits non-zero`, `status=${res.status}`);
  check(!cmds.some((c) => LIFECYCLE_CMDS.includes(c)), `${label}: still never starts a daemon`, `saw: ${JSON.stringify(cmds)}`);
  check(!SUCCESS.test(`${res.stdout}`), `${label}: does not print the success line`);
  check(
    expectLogin ? cmds.length === 1 && cmds[0] === "login" : cmds.length === 0,
    `${label}: ${expectLogin ? "login was attempted, nothing else" : "the token is never sent"}`,
    `saw: ${JSON.stringify(cmds)}`,
  );
  if (expectDownload !== null) {
    check(existsSync(trackerBin(box.home)) === expectDownload, `${label}: download ${expectDownload ? "happened" : "was not reached"}`);
  }
  check(readFileSync(join(box.home, ".vibehub", "tracker.pid"), "utf8") === "999999", `${label}: an already-running daemon is left untouched`);
}

/**
 * The runtime half of W2: whatever else a run does, its first line of output is the
 * banner — proving the print really is the first statement and not merely present
 * somewhere in the file. Asserted on a successful run and on the earliest-failing
 * one, so no branch can slip back to a silent start.
 */
const PS1_BANNER = /^->\s+VibeHub tracker setup$/;
function assertAnnouncesItself(label, res) {
  const firstLine = `${res.stdout}`.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  check(PS1_BANNER.test(firstLine.trim()), `${label}: announces itself before doing any work`, `first line of stdout: ${JSON.stringify(firstLine)}`);
}

/** Pull the start/status/stop commands out of what the installer printed. */
function printedCommands(stdout) {
  const out = {};
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(start|status|stop):\s+(\S.*?)\s*$/);
    if (m && !out[m[1]]) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Run the exact command strings the installer told the user to run, and assert
 * the tracker receives them as the right verb. This is what proves the printed
 * quoting actually survives — in particular for a HOME containing a space.
 */
async function assertPrintedCommandsRun(label, box, res, shell) {
  const cmds = printedCommands(res.stdout);
  const have = ["start", "status", "stop"].filter((v) => cmds[v]);
  check(have.length === 3, `${label}: prints all three commands`, `parsed: ${JSON.stringify(cmds)}`);
  if (have.length !== 3) return;
  for (const verb of have) {
    check(!cmds[verb].includes(TOKEN), `${label}: printed ${verb} command carries no token`);
    const before = readLog(box.log).length;
    const env = { ...process.env, VIBEHUB_TEST_LOG: box.log };
    const r =
      shell === "bash"
        ? await run("bash", ["-c", cmds[verb]], { env })
        : await run("powershell", ["-NoProfile", "-Command", cmds[verb]], { env });
    const fresh = readLog(box.log).slice(before);
    check(
      fresh.length === 1 && fresh[0].length === 1 && fresh[0][0] === verb,
      `${label}: printed ${verb} command runs and reaches the tracker as exactly ["${verb}"]`,
      `argv seen: ${JSON.stringify(fresh)} | cmd: ${cmds[verb]} | stderr: ${(r.stderr || "").trim().slice(0, 200)}`,
    );
  }
}

// --- Preconditions for the node-shim cases --------------------------------
section("preconditions");
if (bashOk) {
  const r = await run("bash", ["-c", `export PATH="${SH_PATH_NO_NODE}"; command -v node || echo NONE`]);
  check(r.stdout.trim() === "NONE", `bash: ${SH_PATH_NO_NODE} really has no node (needed by the missing-node case)`, r.stdout.trim());
}
if (pwshOk) {
  const r = await run("powershell", ["-NoProfile", "-Command", "if (Get-Command node -ErrorAction SilentlyContinue) { 'FOUND' } else { 'NONE' }"], {
    env: { ...process.env, PATH: PS_PATH_NO_NODE },
  });
  check(r.stdout.trim() === "NONE", `powershell: the stripped PATH really has no node (needed by the missing-node case)`, r.stdout.trim());
}

let ps1Blocked = false;
if (pwshOk) {
  const policy = await ps1FileRunnable();
  if (!policy.ok) {
    ps1Blocked = true;
    blockers.push(
      "install.ps1 could not be executed: this machine's PowerShell execution policy blocks running script files, " +
        "and this suite deliberately does not pass -ExecutionPolicy Bypass to get around it. " +
        "install.ps1 is therefore UNVERIFIED here. To verify it, change the policy yourself " +
        "(e.g. Set-ExecutionPolicy -Scope CurrentUser RemoteSigned) and re-run. " +
        `Probe said: ${policy.detail || "(no stderr)"}`,
    );
  } else {
    check(true, "powershell: .ps1 files run under the current policy with -NoProfile -File (no bypass needed)");
  }
}

// --- The matrix -----------------------------------------------------------
for (const [name, runInstaller, available, shell, noNodePath, shimKind] of [
  ["install.sh", runSh, bashOk, "bash", SH_PATH_NO_NODE, "sh"],
  ["install.ps1", runPs1, pwshOk && !ps1Blocked, "powershell", PS_PATH_NO_NODE, "ps"],
]) {
  section(`${name} — sandbox runs`);
  if (!available) {
    console.log(`  skip (${name === "install.sh" ? "no bash on this machine" : ps1Blocked ? "BLOCKED — see blockers below" : "no powershell on this machine"})`);
    continue;
  }

  serveMode = "tracker";
  let box = freshSandbox();
  let res = await runInstaller(box);
  assertSetupOnly(`${name} happy path`, box, res);
  if (name === "install.ps1") assertAnnouncesItself(`${name} happy path`, res);
  await assertPrintedCommandsRun(`${name} happy path`, box, res, shell);

  box = freshSandbox({ spaced: true });
  res = await runInstaller(box);
  assertSetupOnly(`${name} HOME with a space`, box, res);
  await assertPrintedCommandsRun(`${name} HOME with a space`, box, res, shell);

  box = freshSandbox();
  assertFailedHonestly(`${name} rejected token`, box, await runInstaller(box, { reject: true }), { expectDownload: true, expectLogin: true });

  serveMode = "truncated";
  box = freshSandbox();
  // The junk body does land on disk (curl -o / -OutFile write before we can
  // judge it); what matters is that it is rejected and the token never leaves.
  assertFailedHonestly(`${name} junk download (200, not the tracker)`, box, await runInstaller(box), { expectDownload: true });

  serveMode = "http-error";
  box = freshSandbox();
  // Whether a zero-byte file is left behind differs between curl and
  // Invoke-WebRequest, so download state is deliberately not asserted here.
  assertFailedHonestly(`${name} non-2xx download (503)`, box, await runInstaller(box), { expectDownload: null });

  serveMode = "tracker";
  box = freshSandbox();
  assertFailedHonestly(`${name} node missing`, box, await runInstaller(box, { pathOverride: noNodePath }), { expectDownload: false });

  box = freshSandbox();
  const oldNodePath = shimKind === "sh" ? `${shimDir("sh")}:${SH_PATH_NO_NODE}` : `${shimDir("ps")};${PS_PATH_NO_NODE}`;
  const oldRes = await runInstaller(box, { pathOverride: oldNodePath });
  assertFailedHonestly(`${name} node older than 18`, box, oldRes, { expectDownload: false });
  check(/18\+ is required/.test(`${oldRes.stdout}${oldRes.stderr}`), `${name} node older than 18: says 18+ is required`, `${oldRes.stderr}`.trim().slice(0, 200));

  box = freshSandbox();
  const noTokenRes = await runInstaller(box, { token: "" });
  assertFailedHonestly(`${name} missing token`, box, noTokenRes, { expectDownload: false });
  // The earliest possible exit: if the banner is there too, nothing runs ahead of it.
  if (name === "install.ps1") assertAnnouncesItself(`${name} missing token`, noTokenRes);
}

// ---------------------------------------------------------------------------
// 3. install.ps1 through `iex` — the invocation the product actually ships.
//
// Everything above runs install.ps1 with `-NoProfile -File`, and -File is blind to
// the defect this path has: PowerShell strips a UTF-8 BOM when it reads a script
// *file*, so a BOM'd install.ps1 passed every -File case in this suite while every
// real Windows user got, as their first line of output,
//   ?# : The term "?#" is not recognized as the name of a cmdlet...
// Measured on this machine, against install.ps1 with a BOM prepended:
//   iex (irm-style decode)  -> CommandNotFoundException in stderr
//   -File                   -> nothing
// which is exactly why the round-10 BOM shipped for months. So the sheet's own
// invocation gets its own case.
//
// Not gated on ps1Blocked: `iex` of a string is not a script file, so execution
// policy does not apply to it — which is part of why the product ships this form.
// ---------------------------------------------------------------------------

section("install.ps1 — through `iex`, the way the connect sheet runs it");
if (!pwshOk) {
  console.log("  skip (no powershell on this machine)");
} else {
  serveMode = "tracker";
  const box = freshSandbox();
  const res = await runPs1ViaIex(box);
  const stderr = `${res.stderr}`;
  check(
    !/CommandNotFoundException/.test(stderr),
    "install.ps1 via iex: no CommandNotFoundException (a UTF-8 BOM produces one here, and only here)",
    stderr.trim().slice(0, 300),
  );
  // assertSetupOnly covers the "OK Installed." line, exit 0, and the setup-only
  // contract on this branch too — the pattern scan alone never executed it.
  assertSetupOnly("install.ps1 via iex", box, res);
  assertAnnouncesItself("install.ps1 via iex", res);
  await assertPrintedCommandsRun("install.ps1 via iex", box, res, "powershell");
}

server.close();
for (const s of scratch) rmSync(s, { recursive: true, force: true });

if (blockers.length > 0) {
  section("BLOCKERS");
  for (const b of blockers) console.log(`  !! ${b}`);
}

const verdict = failures === 0 && blockers.length === 0 ? "PASS" : failures === 0 ? "BLOCKED" : "FAIL";
console.log(`\n${verdict} — ${passes} passed, ${failures} failed, ${blockers.length} blocker(s)`);
process.exit(verdict === "PASS" ? 0 : 1);
