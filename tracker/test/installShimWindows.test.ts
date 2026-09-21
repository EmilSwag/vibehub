// The `vibehub-tracker` command on Windows - the launcher `connect.ps1` writes.
//
// These cases EXECUTE. The launcher functions are extracted verbatim from the shipped
// `web/public/tracker/connect.ps1` (between the `vibehub-launcher v1` markers), dot-sourced
// into a real PowerShell, and the `.cmd` they produce is then run by a real `cmd.exe` and
// by PowerShell - because a launcher that only looks right is worth nothing.
//
// What is covered, and why each one bit somewhere before:
//   - spaces AND non-ASCII in the home directory. A batch file is read in the console's
//     OEM code page, so an absolute path through `C:\Users\Пример` would be mangled; the
//     launcher writes `%USERPROFILE%\…` instead and cmd expands it at run time.
//   - the way a VENDOR spawns a hook: `cmd /c "<command>"`. cmd strips the first and last
//     quote of such a line, which breaks two quoted paths in a row - the reason Windows
//     registers the one-token launcher rather than `node.exe` + `.cjs`.
//   - argument, stdin and exit-code passthrough, a foreign file never clobbered, an
//     idempotent rewrite, self-removal once `~/.vibehub` is gone, and a repairable install
//     keeping its command.
//
// The second group goes further: it runs the real `hooks install`, reads the command
// string back OUT of the vendor's own `hooks.json`, and executes THAT string - never one
// rebuilt here - through every runner shape the vendors document, with a synthetic home
// whose path carries both spaces and non-ASCII. Then `uninstall`, executed the same way.
//
// Synthetic only: a throwaway HOME/LOCALAPPDATA, a stub `node.exe`, no real `~/.vibehub`,
// no real `%LOCALAPPDATA%`, no real `~/.cursor` or `~/.codeium`, no IDE, no network.
// Skips wholesale off Windows.

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";

const repo = resolve(__dirname, "../..");
const CONNECT_PS1 = join(repo, "web/public/tracker/connect.ps1");
const OPEN = "# >>> vibehub-launcher v1";
const CLOSE = "# <<< vibehub-launcher v1";
const windows = process.platform === "win32";

const tempRoot = resolve(__dirname, "../../../.temp/vibehub-ai-only");
mkdirSync(tempRoot, { recursive: true });
const sandbox = mkdtempSync(join(tempRoot, "win-shim-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

/** The launcher functions exactly as shipped, with nothing else in scope. */
function launcherBlock(): string {
  const text = readFileSync(CONNECT_PS1, "utf8");
  const start = text.indexOf(OPEN);
  const end = text.indexOf(CLOSE);
  assert.ok(start >= 0 && end > start, "connect.ps1 carries no launcher block");
  return text.slice(start, end + CLOSE.length);
}

interface Install {
  home: string;
  localAppData: string;
  launcher: string;
  node: string;
  cjs: string;
  root: string;
  text: string;
  state: string;
}

/**
 * Runs the shipped `Install-VibeHubLauncher` inside a fixture home, then returns what it
 * produced. `homeName` carries spaces and non-ASCII on purpose.
 */
function installLauncher(homeName: string, seed?: (install: Omit<Install, "text" | "state">) => void, unique = false, cjsOverride?: string): Install {
  // `unique` keeps repeated calls from sharing a home, so one case cannot see another's inbox.
  const home = join(sandbox, unique ? `${homeName}-${Math.random().toString(36).slice(2, 8)}` : homeName);
  const localAppData = join(home, "AppData", "Local");
  const root = join(home, ".vibehub");
  // The real node: a batch file named node.exe would never execute, and the point of
  // these cases is that the launcher really does spawn its target.
  const node = process.execPath;
  // The stub always lives in the fixture home; `cjsOverride` only changes what the
  // launcher POINTS AT, so a real CLI path is never written over.
  const stub = join(root, "app", "vibehub-tracker.cjs");
  const cjs = cjsOverride ?? stub;
  const launcher = join(localAppData, "Programs", "VibeHub", "vibehub-tracker.cmd");
  mkdirSync(join(root, "runtime"), { recursive: true });
  mkdirSync(join(root, "app"), { recursive: true });
  // A stand-in for the tracker bundle: echoes its arguments and its stdin, exits 7.
  // It is written to `stub`, NEVER to `cjsOverride`: an earlier revision wrote it to
  // whichever path the launcher was told to point at, which silently replaced the real
  // `dist/index.js` with this five-line echo and made every case below meaningless.
  writeFileSync(stub, [
    'process.stdout.write("ARGS:" + process.argv.slice(2).join(" ") + "\\n");',
    'let seen = "";',
    'process.stdin.on("data", (d) => { seen += d; });',
    'process.stdin.on("end", () => { process.stderr.write(seen); process.exit(7); });',
    'process.stdin.on("error", () => process.exit(7));',
  ].join("\n"));
  seed?.({ home, localAppData, launcher, node, cjs, root });
  // PowerShell does not treat a backslash as an escape, so JSON.stringify's doubled
  // backslashes would reach the launcher verbatim and every path would be wrong.
  const ps = (value: string): string => `'${value.replace(/'/g, "''")}'`;
  const script = [
    launcherBlock(),
    `$env:USERPROFILE = ${ps(home)}`,
    `$env:LOCALAPPDATA = ${ps(localAppData)}`,
    `$state = Install-VibeHubLauncher ${ps(root)} ${ps(node)} ${ps(cjs)}`,
    "Write-Output \"state=$state\"",
  ].join("\n");
  const file = join(sandbox, `install-${homeName.replace(/[^\w]/g, "_")}.ps1`);
  // PowerShell 5.1 reads a BOM-less .ps1 as ANSI, which would mangle the fixture
  // path before the launcher ever sees it. The BOM makes it read UTF-8.
  writeFileSync(file, `﻿${script}`, "utf8");
  const run = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], { encoding: "utf8" });
  // `run.error` first: if powershell cannot be spawned at all (PATH without System32, say)
  // stderr is undefined and the bare `error:undefined` that produced says nothing about why
  // seventeen cases just failed.
  const state = /state=(\w+)/.exec(run.stdout ?? "")?.[1]
    ?? (run.error ? `powershell could not be spawned: ${run.error.message}` : `error:${run.stderr?.slice(0, 200)}`);
  return { home, localAppData, launcher, node, cjs, root,
    text: existsSync(launcher) ? readFileSync(launcher, "latin1") : "", state };
}

/** Runs the launcher the way a shell would, with USERPROFILE pointing at the fixture. */
function runLauncher(install: Install, args: string[], input = ""): { status: number; out: string; err: string } {
  const result = spawnSync("cmd", ["/d", "/c", install.launcher, ...args], {
    encoding: "utf8", input,
    env: { ...process.env, USERPROFILE: install.home, HOME: install.home },
  });
  return { status: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? "" };
}

describe("windows launcher: written by connect.ps1, executed here", { skip: !windows && "not Windows" }, () => {
  it("writes a marked, ASCII, %USERPROFILE%-relative .cmd even for a spaced, non-ASCII home", () => {
    const install = installLauncher("Ünïcødé Home Пример");
    assert.equal(install.state, "written", install.state);
    assert.ok(existsSync(install.launcher));
    assert.ok(install.text.includes("# vibehub-tracker shim v1 (managed by VibeHub; safe to delete)"));
    // The home's own characters must NOT be in the file: cmd would read them in the OEM
    // code page. `%USERPROFILE%` is expanded at run time instead.
    assert.equal(install.text.includes("Ünïcødé"), false, "a non-ASCII path was embedded");
    assert.ok(install.text.includes("%USERPROFILE%"), "paths are not USERPROFILE-relative");
    // eslint-disable-next-line no-control-regex
    assert.equal(/[^\x00-\x7F]/.test(install.text), false, "the launcher is not pure ASCII");
  });

  it("passes arguments, stdin and the exit code through", () => {
    const install = installLauncher("Passthrough Home");
    const result = runLauncher(install, ["hooks", "install", "cursor"], "piped-stdin\r\n");
    assert.match(result.out, /ARGS:hooks install cursor/);
    // stdin reaches the child - what `login --token-stdin` and `hook` depend on.
    assert.match(result.err, /piped-stdin/);
    assert.equal(result.status, 7, "the command's own exit code must survive");
  });

  it("survives the way a vendor spawns a hook: cmd /c \"<command>\"", () => {
    // cmd strips the first and last quote of such a line. One quoted token plus plain
    // arguments is safe; two quoted paths in a row are not - which is why the hook
    // registers the launcher and not node.exe + .cjs.
    const install = installLauncher("Vendor Runner Home");
    const command = `"${install.launcher}" hook cursor`;
    // `windowsVerbatimArguments` matters: without it Node quotes the already-quoted line
    // again and the test would be measuring its own harness rather than cmd.
    const result = spawnSync("cmd", ["/d", "/c", command], {
      encoding: "utf8", windowsVerbatimArguments: true,
      env: { ...process.env, USERPROFILE: install.home, HOME: install.home },
    });
    assert.equal(result.status, 7, result.stderr);
    assert.match(result.stdout ?? "", /ARGS:hook cursor/);

    // Measured, not assumed: the same line built from node + the .cjs - two quoted paths
    // in a row - is what cmd cannot parse. That is why Windows registers the launcher.
    const twoPaths = spawnSync("cmd", ["/d", "/c", `"${install.node}" "${install.cjs}" hook cursor`], {
      encoding: "utf8", windowsVerbatimArguments: true,
      env: { ...process.env, USERPROFILE: install.home, HOME: install.home },
    });
    assert.notEqual(twoPaths.status, 7, "two quoted paths unexpectedly parsed; revisit the rationale");
  });

  it("is runnable from PowerShell as well as cmd", () => {
    const install = installLauncher("PowerShell Home");
    const result = spawnSync("powershell", ["-NoProfile", "-Command",
      `& ${JSON.stringify(install.launcher)} hook windsurf; exit $LASTEXITCODE`],
      { encoding: "utf8", env: { ...process.env, USERPROFILE: install.home, HOME: install.home } });
    assert.equal(result.status, 7, result.stderr);
    assert.match(result.stdout ?? "", /ARGS:hook windsurf/);
  });

  it("rewrites itself in place and never stacks a second copy", () => {
    const install = installLauncher("Idempotent Home");
    const first = install.text;
    const again = installLauncher("Idempotent Home");
    assert.equal(again.state, "written");
    assert.equal(again.text, first);
    assert.equal((again.text.match(/VIBEHUB_CJS=/g) ?? []).length, 1);
  });

  it("never clobbers a vibehub-tracker.cmd that is not ours", () => {
    const foreign = "@echo off\r\necho someone elses tool\r\n";
    const install = installLauncher("Foreign Home", (paths) => {
      mkdirSync(join(paths.localAppData, "Programs", "VibeHub"), { recursive: true });
      writeFileSync(paths.launcher, foreign);
    });
    assert.equal(install.state, "foreign");
    assert.equal(readFileSync(install.launcher, "latin1"), foreign);
  });

  it("removes itself once ~/.vibehub is gone, leaving nothing on PATH", () => {
    const install = installLauncher("Removal Home");
    rmSync(install.root, { recursive: true, force: true });
    const result = runLauncher(install, ["status"]);
    assert.equal(result.status, 127);
    assert.match(result.err, /removed itself|remove this command/);
    assert.equal(existsSync(install.launcher), false, "a dangling command was left behind");
  });

  it("keeps itself when the install is merely incomplete", () => {
    const install = installLauncher("Incomplete Home");
    rmSync(install.cjs); // interrupted upgrade: ~/.vibehub is still there
    const result = runLauncher(install, ["status"]);
    assert.equal(result.status, 127);
    assert.match(result.err, /incomplete/);
    assert.ok(existsSync(install.launcher), "a repairable install must keep its command");
  });

  it("is the command `uninstall` looks for, and it is removable", () => {
    const install = installLauncher("Uninstall Home");
    const previous = { LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE };
    try {
      process.env.LOCALAPPDATA = install.localAppData;
      process.env.USERPROFILE = install.home;
      const { removeOwnedShims, shimCandidates } = require("../src/hooks/install") as typeof import("../src/hooks/install");
      assert.deepEqual(shimCandidates(), [install.launcher]);
      // The launcher names the tracker as %USERPROFILE%\…; uninstall must still recognise
      // it as this install's own, or a Windows uninstall would leave the command behind.
      const [result] = removeOwnedShims(install.cjs, [install.launcher]);
      assert.equal(result.outcome, "removed", JSON.stringify(result));
      assert.equal(existsSync(install.launcher), false);
    } finally {
      process.env.LOCALAPPDATA = previous.LOCALAPPDATA;
      process.env.USERPROFILE = previous.USERPROFILE;
    }
  });
});

describe("windows hook commands: executed through the runners the vendors document",
  { skip: !windows && "not Windows" }, () => {
  const cli = resolve(__dirname, "../dist/index.js");

  interface Installed {
    home: string;
    root: string;
    launcher: string;
    localAppData: string;
    inbox: string;
    /** The exact strings the installer wrote, read back out of the vendor's own file. */
    cursor: string;
    windsurf: string;
    entry: Record<string, unknown>;
    cursorFile: string;
    windsurfFile: string;
    records: () => Record<string, unknown>[];
  }

  /**
   * Installs the launcher AND the real hooks.json in a fixture home, then hands back the
   * command strings exactly as a vendor would read them. `seed` runs before the install,
   * so a case can put somebody else's hook in the vendor file first.
   */
  function installed(seed?: (paths: { cursorFile: string; windsurfFile: string }) => void): Installed {
    assert.ok(existsSync(cli), "run `npm run build` first: these cases execute the built CLI");
    const sealed = readFileSync(cli);
    const install = installLauncher("Runner Home Пример", undefined, true, cli);
    writeFileSync(join(install.root, "config.json"), JSON.stringify({
      apiUrl: "https://tracker-fixture.invalid",
      deviceToken: "SYNTHETIC_ONLY_NOT_A_CREDENTIAL",
      projectAliases: {},
      attestedMetadata: { enabled: true, tools: ["cursor", "windsurf"] },
    }));
    const cursorFile = join(install.home, ".cursor", "hooks.json");
    const windsurfFile = join(install.home, ".codeium", "windsurf", "hooks.json");
    seed?.({ cursorFile, windsurfFile });
    const env = { ...process.env, HOME: install.home, USERPROFILE: install.home, LOCALAPPDATA: install.localAppData };
    for (const tool of ["cursor", "windsurf"]) {
      const r = spawnSync(process.execPath, [cli, "hooks", "install", tool], { env, encoding: "utf8" });
      assert.equal(r.status, 0, `hooks install ${tool}: ${r.stdout}${r.stderr}`);
    }
    // The fixture executes the build; it must never write it. See installLauncher.
    assert.ok(readFileSync(cli).equals(sealed), "the fixture modified the built CLI");
    const cursorJson = JSON.parse(readFileSync(cursorFile, "utf8"));
    const windsurfJson = JSON.parse(readFileSync(windsurfFile, "utf8"));
    // OURS, not simply the first: an entry that was already in the file keeps its place
    // and ours is appended after it, so `hooks.stop[0]` can be a stranger's command.
    const ourEntry = (entries: Record<string, unknown>[], tool: string): Record<string, unknown> => {
      const mine = entries.filter((item) => typeof item.command === "string" && item.command.endsWith(`hook ${tool}`));
      assert.equal(mine.length, 1, `expected exactly one VibeHub entry for ${tool}, found ${mine.length}`);
      return mine[0];
    };
    const entry = ourEntry(windsurfJson.hooks.post_cascade_response, "windsurf");
    const inbox = join(install.root, "attested.jsonl");
    return {
      home: install.home, root: install.root, launcher: install.launcher,
      localAppData: install.localAppData, inbox, cursorFile, windsurfFile,
      cursor: String(ourEntry(cursorJson.hooks.stop, "cursor").command), windsurf: String(entry.command), entry,
      records: () => existsSync(inbox)
        ? readFileSync(inbox, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
        : [],
    };
  }

  const payloadFor = (over: Record<string, unknown> = {}): string => JSON.stringify({
    hook_event_name: "stop", agent_action_name: "post_cascade_response",
    model: "claude-opus-5", model_name: "claude-opus-5",
    prompt: "SECRET-PROMPT", transcript_path: "C:\\x\\SECRET.jsonl",
    user_email: "SECRET@example.invalid", conversation_id: "SECRET-CONVERSATION",
    ...over,
  });
  const payload = payloadFor();

  const homeEnv = (install: Installed): NodeJS.ProcessEnv =>
    ({ ...process.env, HOME: install.home, USERPROFILE: install.home });

  /**
   * The three runner shapes of the report's §8.3 matrix, applied to the command string as
   * stored - never to one rebuilt here, which is the whole point of these cases.
   *
   * `windowsVerbatimArguments` matters for the bare form: without it Node re-quotes the
   * already-quoted line and the measurement becomes one of Node, not of cmd.
   */
  const inCmd = (line: string, env: NodeJS.ProcessEnv, input: string) =>
    spawnSync("cmd", ["/d", "/c", line], { encoding: "utf8", windowsVerbatimArguments: true, env, input });
  const inCmdWrapped = (line: string, env: NodeJS.ProcessEnv, input: string) =>
    // `shell: true` on Windows is `cmd.exe /d /s /c "<line>"` - what an Electron app does.
    spawnSync(line, { shell: true, encoding: "utf8", env, input });
  const inPowerShell = (line: string, env: NodeJS.ProcessEnv, input: string) =>
    spawnSync("powershell", ["-NoProfile", "-Command", line], { encoding: "utf8", env, input });

  const silent = (result: { stdout: string | null; stderr: string | null }): string =>
    `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();

  it("registers ONE identical, quoted, single-token command on every subscribed event", () => {
    const install = installed();
    const cursorJson = JSON.parse(readFileSync(install.cursorFile, "utf8"));
    assert.deepEqual(Object.keys(cursorJson.hooks).sort(), ["afterAgentResponse", "stop"]);
    for (const event of ["afterAgentResponse", "stop"]) {
      assert.equal(cursorJson.hooks[event].length, 1, `${event} stacked a second hook`);
      assert.equal(cursorJson.hooks[event][0].command, install.cursor);
    }
    const windsurfJson = JSON.parse(readFileSync(install.windsurfFile, "utf8"));
    assert.deepEqual(Object.keys(windsurfJson.hooks).sort(), ["post_cascade_response", "pre_user_prompt"]);
    for (const event of ["post_cascade_response", "pre_user_prompt"]) {
      assert.equal(windsurfJson.hooks[event].length, 1, `${event} stacked a second hook`);
      assert.equal(windsurfJson.hooks[event][0].command, install.windsurf);
    }
    // The fixture home carries spaces AND non-ASCII, so the stored command does too: it
    // has to be ONE quoted token, not an escaped path and not two paths in a row.
    assert.ok(install.cursor.includes("Runner Home Пример"), install.cursor);
    assert.ok(install.cursor.startsWith("\"") && install.cursor.endsWith("\" hook cursor"), install.cursor);
    assert.equal(install.cursor.slice(1).split("\"").length, 2, "more than one quoted token");
  });

  it("Cursor's stored command fires under BOTH cmd shapes and says nothing at all", () => {
    const install = installed();
    const env = homeEnv(install);
    // A runner that spawns the line as-is: `cmd /d /c "<launcher>" hook cursor`.
    const bare = inCmd(install.cursor, env, payload);
    assert.equal(bare.status, 0, bare.stderr);
    assert.equal(silent(bare), "", "the hook talked into the IDE's own output");
    // And the Electron shape, which wraps the whole line: `cmd /d /s /c "<line>"`.
    const wrapped = inCmdWrapped(install.cursor, env, payload);
    assert.equal(wrapped.status, 0, wrapped.stderr);
    assert.equal(silent(wrapped), "");

    const records = install.records();
    assert.equal(records.length, 2, "one record per firing, no more and no fewer");
    assert.deepEqual([...new Set(records.map((record) => record.tool))], ["cursor"]);
    for (const record of records) {
      assert.deepEqual(Object.keys(record).sort(), ["model", "occurredAt", "recordId", "tool", "v"]);
      assert.equal(record.model, "claude-opus-5");
    }
    assert.notEqual(records[0].recordId, records[1].recordId, "a vendor identifier is being reused");
    assert.equal(readFileSync(install.inbox, "utf8").includes("SECRET"), false, "a dropped field reached the inbox");
  });

  it("Windsurf's stored command fires under `powershell -Command`, and so does its `powershell` field", () => {
    const install = installed();
    const env = homeEnv(install);
    // Cascade's docs: on Windows a hook runs through `powershell -Command`, and `command`
    // falls back to the same interpreter - where a quoted path alone is a string literal.
    assert.ok(install.windsurf.startsWith("& '"), install.windsurf);
    assert.equal(install.entry.powershell, install.windsurf, "the documented powershell field must be set too");
    assert.equal(install.entry.show_output, false, "Cascade would print our output in its UI");
    for (const line of [install.windsurf, String(install.entry.powershell)]) {
      const result = inPowerShell(line, env, payload);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(silent(result), "", "the hook talked into the IDE's own output");
    }
    const records = install.records();
    assert.equal(records.length, 2);
    assert.deepEqual([...new Set(records.map((record) => record.tool))], ["windsurf"]);
    assert.equal(readFileSync(install.inbox, "utf8").includes("SECRET"), false, "a dropped field reached the inbox");
  });

  it("each command is wrong for the OTHER vendor's runner - so neither is guesswork", () => {
    const install = installed();
    const env = homeEnv(install);
    // The cmd form is a bare string literal to PowerShell...
    assert.notEqual(inPowerShell(install.cursor, env, payload).status, 0);
    // ...and `&` is a reserved character to cmd.
    assert.notEqual(inCmdWrapped(install.windsurf, env, payload).status, 0);
    assert.equal(install.records().length, 0, "a misrouted command still wrote a record");
  });

  it("carries a spaced workspace folder through the runner, and drops a non-ASCII one", () => {
    const install = installed();
    const env = homeEnv(install);
    // Both paths go in on stdin as UTF-8 and come back out through cmd's own pipe: this is
    // where a code-page mistake would show up as mojibake rather than as a refusal.
    assert.equal(inCmd(install.cursor, env, payloadFor({ workspace_roots: ["C:\\Users\\dev\\My Project"] })).status, 0);
    assert.equal(inCmd(install.cursor, env, payloadFor({ workspace_roots: ["C:\\Users\\dev\\Проект Один"] })).status, 0);
    const [spaced, unicode] = install.records();
    assert.equal(spaced.projectHint, "My Project", "a legal folder basename was lost");
    assert.equal(Object.hasOwn(unicode, "projectHint"), false, "a non-ASCII folder must yield no hint at all");
    // eslint-disable-next-line no-control-regex
    assert.equal(/[^\x00-\x7F]/.test(readFileSync(install.inbox, "utf8")), false, "a non-ASCII path reached the inbox");
  });

  it("`uninstall` removes both hooks, the command and the config - and nothing else", () => {
    const stranger = { version: 1, hooks: { stop: [{ command: "C:\\Vendor\\their-tool.exe stop" }] } };
    const install = installed(({ cursorFile }) => {
      mkdirSync(dirname(cursorFile), { recursive: true });
      writeFileSync(cursorFile, `${JSON.stringify(stranger, null, 2)}\n`);
    });
    const env = homeEnv(install);
    // Fire one real event first, so there is an inbox to prove `uninstall` leaves alone.
    assert.equal(inCmd(install.cursor, env, payload).status, 0);
    const inboxBefore = readFileSync(install.inbox, "utf8");

    const result = spawnSync(process.execPath, [cli, "uninstall"],
      { env: { ...env, LOCALAPPDATA: install.localAppData }, encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);

    // Cursor's file survives because somebody else's hook is in it; ours is gone from it.
    const after = JSON.parse(readFileSync(install.cursorFile, "utf8"));
    assert.deepEqual(after.hooks.stop, stranger.hooks.stop, "a stranger's hook was touched");
    assert.equal(Object.hasOwn(after.hooks, "afterAgentResponse"), false, "our hook survived uninstall");
    // Windsurf's held nothing but ours, so it is removed outright rather than left a husk.
    assert.equal(existsSync(install.windsurfFile), false);
    assert.equal(existsSync(install.launcher), false, "the vibehub-tracker command was left on PATH");
    assert.equal(existsSync(join(install.root, "config.json")), false, "config.json survived uninstall");
    assert.equal(readFileSync(install.inbox, "utf8"), inboxBefore, "uninstall touched the producer's inbox");

    // And the hook is inert afterwards: the command is gone, so nothing can fire at all.
    const afterwards = inCmd(install.cursor, env, payload);
    assert.notEqual(afterwards.status, 0, "a removed command still ran");
    assert.equal(readFileSync(install.inbox, "utf8"), inboxBefore);
  });

  it("refuses to register a hook when the launcher is not installed", () => {
    // The launcher comes from the Windows connector, not from this command. A hook that
    // points at a missing file fails silently in every runner, so it is refused outright.
    const cli = resolve(__dirname, "../dist/index.js");
    const install = installLauncher("No Launcher Home", undefined, true, cli);
    rmSync(install.launcher);
    writeFileSync(join(install.root, "config.json"), JSON.stringify({
      apiUrl: "https://tracker-fixture.invalid", deviceToken: "SYNTHETIC_ONLY_NOT_A_CREDENTIAL", projectAliases: {},
    }));
    const r = spawnSync(process.execPath, [cli, "hooks", "install", "cursor"], {
      env: { ...process.env, HOME: install.home, USERPROFILE: install.home, LOCALAPPDATA: install.localAppData },
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0);
    assert.match(`${r.stdout}${r.stderr}`, /not installed yet/);
    assert.equal(existsSync(join(install.home, ".cursor", "hooks.json")), false, "a hook was written anyway");
  });
});
