// Round 5: `vibehub-tracker hooks install <tool>` - the only place this project writes a
// file it does not own, and only when the user asks for it by name.
//
// What these checks defend: a vendor's hook file is somebody else's document. Other
// people's hook entries, unknown events and unknown keys survive; a shape we do not
// recognise aborts instead of being rewritten; the first modification leaves a backup; and
// consent moves in step with the hook, because a hook without consent fills an inbox
// nobody reads and consent without a hook collects nothing.
//
// SAFETY: HOME/USERPROFILE are redirected to a throwaway directory BEFORE any tracker
// module is required, and the redirect is asserted - so `~/.cursor/hooks.json` and
// `~/.codeium/windsurf/hooks.json` below are fixtures inside that sandbox, never the real
// ones. No IDE is installed, launched or detected; nothing outside the sandbox is read.

import { strict as assert } from "node:assert";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { beforeEach, describe, it } from "node:test";

const tempRoot = resolve(__dirname, "../../../.temp/vibehub-ai-only");
mkdirSync(tempRoot, { recursive: true });
const sandbox = mkdtempSync(join(tempRoot, "hook-install-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.HOMEDRIVE = sandbox.slice(0, 2);
process.env.HOMEPATH = sandbox.slice(2);
// Windows resolves the launcher through LOCALAPPDATA; point it at the sandbox so nothing
// here can see - let alone write - the real %LOCALAPPDATA%\Programs\VibeHub.
process.env.LOCALAPPDATA = join(sandbox, "AppData", "Local");

const { CONFIG_DIR } = require("../src/paths") as typeof import("../src/paths");
if (!CONFIG_DIR.startsWith(sandbox)) {
  throw new Error(`refusing to run: the tracker resolves ${CONFIG_DIR}, not the sandbox ${sandbox}`);
}
const install = require("../src/hooks/install") as typeof import("../src/hooks/install");
const { ensureInboxExists } = require("../src/hooks/inbox") as typeof import("../src/hooks/inbox");
const { readConfig, writeConfig, attestedToolsFor } = require("../src/config") as typeof import("../src/config");
import type { HookFilePlan } from "../src/hooks/install";
import type { TrackerConfig } from "../src/types";

const EXEC = process.platform === "win32" ? "C:\\Program Files\\nodejs\\node.exe" : "/usr/bin/node";
const SCRIPT = join(sandbox, "Applications", "vibehub-tracker.cjs");
const command = (tool: "cursor" | "windsurf"): string => install.hookCommandFor(tool, EXEC, SCRIPT);
const baseConfig: TrackerConfig = {
  apiUrl: "https://tracker-fixture.invalid",
  deviceToken: "SYNTHETIC_ONLY_NOT_A_CREDENTIAL",
  projectAliases: {},
};
const seedVendorFile = (tool: "cursor" | "windsurf", value: unknown): string => {
  const file = install.hookFileFor(tool);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
};
const readVendorFile = (tool: "cursor" | "windsurf"): Record<string, unknown> =>
  JSON.parse(readFileSync(install.hookFileFor(tool), "utf8")) as Record<string, unknown>;
const installNow = (tool: "cursor" | "windsurf"): HookFilePlan => {
  const plan = install.planHookInstall(tool, command(tool));
  install.applyHookPlan(plan);
  return plan;
};

beforeEach(() => {
  // On Windows `hooks install` refuses when the launcher is missing, because a hook that
  // points at a file which is not there fails silently in every runner. The connector
  // writes it in real life; this fixture stands in for it.
  if (process.platform === "win32") {
    const launcher = install.windowsLauncher();
    mkdirSync(dirname(launcher), { recursive: true });
    writeFileSync(launcher, `@echo off\nrem ${install.SHIM_MARK}\n`);
  }
  rmSync(join(sandbox, ".cursor"), { recursive: true, force: true });
  rmSync(join(sandbox, ".codeium"), { recursive: true, force: true });
  rmSync(CONFIG_DIR, { recursive: true, force: true });
  writeConfig(baseConfig);
});

describe("hooks install: the file each vendor documents, in the shape it documents", () => {
  it("writes Cursor's schema, with version 1 and its two turn-completion events", () => {
    const plan = installNow("cursor");
    assert.equal(plan.file, join(sandbox, ".cursor", "hooks.json"));
    assert.deepEqual(readVendorFile("cursor"), {
      version: 1,
      hooks: {
        afterAgentResponse: [{ command: command("cursor") }],
        stop: [{ command: command("cursor") }],
      },
    });
  });

  it("writes Cascade's schema, with no version key and output silenced", () => {
    const plan = installNow("windsurf");
    assert.equal(plan.file, join(sandbox, ".codeium", "windsurf", "hooks.json"));
    // Cascade documents a `powershell` field that takes precedence on Windows, and that
    // its `command` also runs through `powershell -Command` there. Both are set on
    // Windows so which interpreter runs it is never in doubt; elsewhere neither applies.
    const entry = process.platform === "win32"
      ? { command: command("windsurf"), show_output: false, powershell: command("windsurf") }
      : { command: command("windsurf"), show_output: false };
    assert.deepEqual(readVendorFile("windsurf"), {
      hooks: { pre_user_prompt: [entry], post_cascade_response: [entry] },
    });
  });

  it("subscribes to nothing else - no prompt, transcript, file, command or MCP event", () => {
    installNow("cursor");
    installNow("windsurf");
    const events = [...Object.keys(readVendorFile("cursor").hooks as object),
      ...Object.keys(readVendorFile("windsurf").hooks as object)];
    assert.deepEqual(events.sort(),
      ["afterAgentResponse", "post_cascade_response", "pre_user_prompt", "stop"]);
    // Named explicitly: the first two would carry a prompt and a whole transcript, and the
    // session boundaries are retired because a boundary is not a turn (F7).
    for (const event of ["beforeSubmitPrompt", "post_cascade_response_with_transcript",
      "sessionStart", "sessionEnd"]) {
      assert.equal(events.includes(event), false, `${event} must not be subscribed`);
    }
  });

  it("registers the right command for this platform, quoting only what needs it", () => {
    if (process.platform === "win32") {
      // A vendor spawns the hook through cmd.exe, whose quoting rule mangles two quoted
      // paths in a row. So Windows registers the ONE-token launcher, which resolves node
      // and the bundle itself.
      // Cursor's runner is cmd-shaped; Cascade documents `powershell -Command` on Windows,
      // where a quoted path on its own is a string literal and needs the call operator.
      const cursor = install.hookCommandFor("cursor", "C:\\node.exe", "C:\\vh\\t.cjs");
      assert.ok(cursor.endsWith(" hook cursor"), cursor);
      assert.ok(cursor.toLowerCase().includes("vibehub-tracker.cmd"), cursor);
      assert.equal(cursor.startsWith("& "), false, "Cursor must not get PowerShell syntax");
      assert.equal(cursor.includes(".cjs"), false, "Windows must not register node + .cjs");
      assert.ok((cursor.match(/"/g) ?? []).length % 2 === 0, "unbalanced quoting");
      const windsurf = install.hookCommandFor("windsurf", "C:\\node.exe", "C:\\vh\\t.cjs");
      assert.ok(windsurf.startsWith("& '"), windsurf);
      assert.ok(windsurf.endsWith("' hook windsurf"), windsurf);
    } else {
      assert.equal(install.hookCommandFor("cursor", "/usr/bin/node", "/opt/vibehub-tracker.cjs"),
        "/usr/bin/node /opt/vibehub-tracker.cjs hook cursor");
      assert.equal(install.hookCommandFor("windsurf", "C:\\Program Files\\nodejs\\node.exe", "C:\\vh\\t.cjs"),
        "\"C:\\Program Files\\nodejs\\node.exe\" C:\\vh\\t.cjs hook windsurf");
    }
  });
});

describe("hooks install: the vendor's file belongs to the vendor", () => {
  it("keeps other people's hooks, other events and unknown top-level keys", () => {
    seedVendorFile("cursor", {
      version: 1,
      telemetry: { enabled: false },
      hooks: {
        stop: [{ command: "audit-log --stop" }],
        beforeShellExecution: [{ command: "guard.sh", failClosed: true }],
      },
    });
    installNow("cursor");
    const after = readVendorFile("cursor");
    assert.deepEqual(after.telemetry, { enabled: false });
    assert.deepEqual((after.hooks as Record<string, unknown>).beforeShellExecution,
      [{ command: "guard.sh", failClosed: true }]);
    // Ours is appended after theirs, never in front of it.
    assert.deepEqual((after.hooks as Record<string, unknown>).stop,
      [{ command: "audit-log --stop" }, { command: command("cursor") }]);
  });

  it("is idempotent: installing twice leaves exactly one entry per event", () => {
    installNow("cursor");
    const second = install.planHookInstall("cursor", command("cursor"));
    assert.equal(second.changed, false);
    install.applyHookPlan(second);
    assert.deepEqual((readVendorFile("cursor").hooks as Record<string, unknown[]>).stop,
      [{ command: command("cursor") }]);
  });

  it("rewrites the command in place when the tracker moved, rather than stacking hooks", () => {
    seedVendorFile("cursor", {
      version: 1,
      hooks: { stop: [{ command: "/old/location/vibehub-tracker.cjs hook cursor" }] },
    });
    installNow("cursor");
    assert.deepEqual((readVendorFile("cursor").hooks as Record<string, unknown[]>).stop,
      [{ command: command("cursor") }]);
  });

  it("upgrades a stale install: our entries leave retired events, theirs stay", () => {
    // Exactly what an earlier VibeHub wrote: our command on the two session boundaries
    // that are no longer subscribed (F7). Re-running install must clear them, or the IDE
    // keeps spawning a process per session event for a record we would refuse anyway.
    seedVendorFile("cursor", {
      version: 1,
      hooks: {
        sessionStart: [{ command: command("cursor") }],
        sessionEnd: [{ command: command("cursor") }, { command: "their-end.sh" }],
        stop: [{ command: command("cursor") }],
      },
    });
    const before = install.hookStatus(baseConfig, EXEC, SCRIPT)[0];
    assert.deepEqual(before.stale, ["sessionStart", "sessionEnd"]);
    installNow("cursor");
    assert.deepEqual(readVendorFile("cursor"), {
      version: 1,
      hooks: {
        // sessionStart held only our entry, so the key is gone entirely.
        sessionEnd: [{ command: "their-end.sh" }],
        stop: [{ command: command("cursor") }],
        afterAgentResponse: [{ command: command("cursor") }],
      },
    });
    assert.deepEqual(install.hookStatus(baseConfig, EXEC, SCRIPT)[0].stale, []);
  });

  it("uninstall also clears a stale install, and still keeps their entries", () => {
    seedVendorFile("cursor", {
      version: 1,
      hooks: {
        sessionStart: [{ command: command("cursor") }],
        sessionEnd: [{ command: "their-end.sh" }, { command: command("cursor") }],
      },
    });
    install.applyHookPlan(install.planHookUninstall("cursor", command("cursor")));
    assert.deepEqual(readVendorFile("cursor"),
      { version: 1, hooks: { sessionEnd: [{ command: "their-end.sh" }] } });
  });

  it("leaves someone else's odd-shaped entry alone instead of erroring on their file", () => {
    // A non-array under an event we do NOT subscribe to is their business; only a bad
    // shape under one of ours is a refusal to rewrite.
    seedVendorFile("cursor", { version: 1, hooks: { workspaceOpen: "their-thing", stop: [] } });
    installNow("cursor");
    assert.equal((readVendorFile("cursor").hooks as Record<string, unknown>).workspaceOpen, "their-thing");
  });

  it("backs the original up once, and never overwrites that backup", () => {
    const original = { version: 1, hooks: { stop: [{ command: "audit-log --stop" }] } };
    seedVendorFile("cursor", original);
    installNow("cursor");
    const backup = install.backupPathFor("cursor");
    assert.deepEqual(JSON.parse(readFileSync(backup, "utf8")), original);
    install.applyHookPlan(install.planHookUninstall("cursor", command("cursor")));
    installNow("cursor");
    assert.deepEqual(JSON.parse(readFileSync(backup, "utf8")), original);
  });

  it("aborts on a shape it does not understand instead of replacing it", () => {
    for (const bad of ["{not json", "[]", "\"text\"",
      JSON.stringify({ version: 2, hooks: {} }),
      JSON.stringify({ hooks: "all of them" }),
      JSON.stringify({ hooks: { stop: "audit-log" } })]) {
      const file = seedVendorFile("cursor", bad);
      const before = readFileSync(file, "utf8");
      assert.throws(() => install.planHookInstall("cursor", command("cursor")), install.HookInstallError);
      assert.equal(readFileSync(file, "utf8"), before, "an aborted install must change nothing");
    }
  });

  it("treats an empty file as an empty configuration rather than an error", () => {
    seedVendorFile("cursor", "");
    installNow("cursor");
    assert.equal(Object.keys(readVendorFile("cursor").hooks as object).length, 2);
  });

  it("a dry run renders the exact bytes and writes nothing", () => {
    const plan = install.planHookInstall("cursor", command("cursor"));
    assert.ok(plan.content?.endsWith("\n"));
    assert.equal(existsSync(plan.file), false);
    install.applyHookPlan(plan);
    assert.equal(readFileSync(plan.file, "utf8"), plan.content);
  });
});

describe("hooks install: refuses what it must not follow or rewrite", () => {
  it("refuses a symlinked hook file instead of writing through it", (t) => {
    const file = install.hookFileFor("cursor");
    const target = join(sandbox, "elsewhere.json");
    writeFileSync(target, JSON.stringify({ version: 1, hooks: {} }));
    mkdirSync(dirname(file), { recursive: true });
    try { symlinkSync(target, file, "file"); }
    catch { return t.skip("this platform does not allow creating symlinks unprivileged"); }
    // A symlink is refused at plan time, so nothing is written through it - and a link
    // created between plan and write would be replaced by the rename, not followed.
    assert.throws(() => install.planHookInstall("cursor", command("cursor")), install.HookInstallError);
    assert.throws(() => install.planHookUninstall("cursor", command("cursor")), install.HookInstallError);
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { version: 1, hooks: {} });
    // `hooks status` must survive the same file without throwing, and must not claim it.
    const [cursor] = install.hookStatus(baseConfig, EXEC, SCRIPT);
    assert.equal(cursor.fileExists, false);
    assert.deepEqual(cursor.registered, []);
  });

  it("refuses a hard-linked hook file", (t) => {
    const file = install.hookFileFor("cursor");
    const target = join(sandbox, "hardlink-target.json");
    writeFileSync(target, JSON.stringify({ version: 1, hooks: {} }));
    mkdirSync(dirname(file), { recursive: true });
    try { linkSync(target, file); }
    catch { return t.skip("this platform does not support hard links here"); }
    assert.throws(() => install.planHookInstall("cursor", command("cursor")), install.HookInstallError);
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { version: 1, hooks: {} });
  });

  it("backs up the ORIGINAL before the new content lands, and leaves no temp files", () => {
    const original = { version: 1, hooks: { stop: [{ command: "audit-log --stop" }] } };
    seedVendorFile("cursor", original);
    installNow("cursor");
    // The backup holds what was there before the write, not a copy of what we wrote.
    assert.deepEqual(JSON.parse(readFileSync(install.backupPathFor("cursor"), "utf8")), original);
    assert.notDeepEqual(readVendorFile("cursor"), original);
    // The write itself is a rename over the path: no partial file is ever visible, and
    // nothing is left behind if it fails.
    assert.deepEqual(readdirSync(dirname(install.hookFileFor("cursor"))).filter((name) => name.includes(".tmp")), []);
  });

  it("is inert for a tool this product does not hook", () => {
    for (const tool of ["claude-code", "codex", "quadcode", "chatgpt", "vscode", "", null, 7]) {
      const unlisted = tool as unknown as "cursor";
      // Every entry point, not just the one the CLI happens to call first: no path is
      // computed, no file is read, no command is built and no consent is written.
      assert.throws(() => install.hookFileFor(unlisted), install.HookInstallError);
      assert.throws(() => install.backupPathFor(unlisted), install.HookInstallError);
      assert.throws(() => install.hookCommandFor(unlisted, EXEC, SCRIPT), install.HookInstallError);
      assert.throws(() => install.planHookInstall(unlisted, "cmd"), install.HookInstallError);
      assert.throws(() => install.planHookUninstall(unlisted, "cmd"), install.HookInstallError);
      assert.throws(() => install.withConsent(baseConfig, unlisted, true), install.HookInstallError);
      assert.equal(install.isHookableTool(tool), false);
    }
    // ...and the status report only ever describes the two tools that do have hooks.
    assert.deepEqual(install.hookStatus(baseConfig, EXEC, SCRIPT).map((state) => state.tool),
      ["cursor", "windsurf"]);
    assert.deepEqual([...install.HOOKABLE_TOOLS], ["cursor", "windsurf"]);
  });
});

describe("hooks uninstall: removes ours and only ours", () => {
  it("restores the user's file byte for byte", () => {
    // The strongest form of "reverse only VibeHub entries": install into a file with
    // entries of theirs on every event we touch, then uninstall, and compare the bytes.
    const file = seedVendorFile("cursor", {
      version: 1,
      telemetry: { enabled: false },
      hooks: {
        sessionStart: [{ command: "their-start.sh" }],
        afterAgentResponse: [{ command: "their-response.sh", timeout: 5 }],
        stop: [{ command: "audit-log --stop" }],
        sessionEnd: [{ command: "their-end.sh" }],
        beforeShellExecution: [{ command: "guard.sh", failClosed: true }],
      },
    });
    const before = readFileSync(file, "utf8");
    installNow("cursor");
    assert.notEqual(readFileSync(file, "utf8"), before);
    install.applyHookPlan(install.planHookUninstall("cursor", command("cursor")));
    assert.equal(readFileSync(file, "utf8"), before, "uninstall did not restore the original bytes");
  });

  it("leaves the other tool's file and consent untouched", () => {
    installNow("cursor");
    installNow("windsurf");
    install.setConsent(readConfig() as TrackerConfig, "cursor", true);
    install.setConsent(readConfig() as TrackerConfig, "windsurf", true);
    const windsurfBefore = readFileSync(install.hookFileFor("windsurf"), "utf8");
    install.applyHookPlan(install.planHookUninstall("cursor", command("cursor")));
    install.setConsent(readConfig() as TrackerConfig, "cursor", false);
    assert.equal(readFileSync(install.hookFileFor("windsurf"), "utf8"), windsurfBefore);
    assert.deepEqual(attestedToolsFor(readConfig() as TrackerConfig), ["windsurf"]);
  });

  it("leaves the file behind when someone else is still using it", () => {
    seedVendorFile("cursor", { version: 1, hooks: { stop: [{ command: "audit-log --stop" }] } });
    installNow("cursor");
    install.applyHookPlan(install.planHookUninstall("cursor", command("cursor")));
    assert.deepEqual(readVendorFile("cursor"),
      { version: 1, hooks: { stop: [{ command: "audit-log --stop" }] } });
  });

  it("removes a file that contains nothing but our own hooks, leaving no litter", () => {
    installNow("windsurf");
    install.applyHookPlan(install.planHookUninstall("windsurf", command("windsurf")));
    assert.equal(existsSync(install.hookFileFor("windsurf")), false);
    // Nothing of the user's was in it, so there is nothing to back up - and a
    // `.vibehub-backup` left in their directory after they removed us is just litter.
    assert.equal(existsSync(install.backupPathFor("windsurf")), false);
  });

  it("is a no-op when nothing of ours is registered", () => {
    seedVendorFile("cursor", { version: 1, hooks: { stop: [{ command: "audit-log --stop" }] } });
    const plan = install.planHookUninstall("cursor", command("cursor"));
    assert.equal(plan.changed, false);
    const absent = install.planHookUninstall("windsurf", command("windsurf"));
    assert.equal(absent.changed, false);
    assert.equal(absent.existed, false);
  });
});

describe("hooks install: consent moves with the hook", () => {
  it("adds and removes exactly one tool, leaving other consent alone", () => {
    writeConfig({ ...baseConfig, attestedMetadata: { enabled: true, tools: ["quadcode"] } });
    install.setConsent(readConfig() as TrackerConfig, "cursor", true);
    assert.deepEqual(attestedToolsFor(readConfig() as TrackerConfig), ["quadcode", "cursor"]);
    install.setConsent(readConfig() as TrackerConfig, "cursor", false);
    assert.deepEqual(attestedToolsFor(readConfig() as TrackerConfig), ["quadcode"]);
  });

  it("switches the receiver off entirely when the last tool goes", () => {
    install.setConsent(readConfig() as TrackerConfig, "windsurf", true);
    assert.deepEqual(attestedToolsFor(readConfig() as TrackerConfig), ["windsurf"]);
    install.setConsent(readConfig() as TrackerConfig, "windsurf", false);
    assert.deepEqual(attestedToolsFor(readConfig() as TrackerConfig), []);
    assert.equal(readConfig()?.attestedMetadata?.enabled, false);
  });

  it("never consents twice to the same tool", () => {
    const once = install.withConsent(baseConfig, "cursor", true);
    assert.deepEqual(install.withConsent(once, "cursor", true).attestedMetadata?.tools, ["cursor"]);
  });
});

describe("uninstall: removes the entry point this install owns, and only that", () => {
  const shimFile = (dir: string, body: string): string => {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "vibehub-tracker");
    writeFileSync(file, body, { mode: 0o755 });
    return file;
  };
  const ourShim = (cjs: string): string =>
    `#!/bin/sh\n${install.SHIM_MARK}\nVIBEHUB_CJS='${cjs}'\nexec node "${cjs}" "$@"\n`;

  it("deletes a shim carrying our marker that points at this install", () => {
    const cjs = join(sandbox, "app", "vibehub-tracker.cjs");
    const file = shimFile(join(sandbox, "bin-a"), ourShim(cjs));
    const [result] = install.removeOwnedShims(cjs, [file]);
    assert.equal(result.outcome, "removed");
    assert.equal(existsSync(file), false);
  });

  it("never touches a command by that name that is not ours", () => {
    const cjs = join(sandbox, "app", "vibehub-tracker.cjs");
    const body = "#!/bin/sh\necho someone elses vibehub-tracker\n";
    const file = shimFile(join(sandbox, "bin-b"), body);
    const [result] = install.removeOwnedShims(cjs, [file]);
    assert.equal(result.outcome, "foreign");
    assert.equal(readFileSync(file, "utf8"), body);
  });

  it("leaves another VibeHub install's shim alone", () => {
    // The Mac app's shim is not the terminal connector's to remove, and vice versa.
    const mine = join(sandbox, "app", "vibehub-tracker.cjs");
    const theirs = "/Applications/VibeHub.app/Contents/Resources/tracker/vibehub-tracker.cjs";
    const file = shimFile(join(sandbox, "bin-c"), ourShim(theirs));
    const [result] = install.removeOwnedShims(mine, [file]);
    assert.equal(result.outcome, "other-install");
    assert.ok(existsSync(file));
  });

  it("reports an absent command without inventing one", () => {
    const [result] = install.removeOwnedShims(join(sandbox, "app.cjs"), [join(sandbox, "bin-d", "vibehub-tracker")]);
    assert.equal(result.outcome, "absent");
    assert.equal(existsSync(join(sandbox, "bin-d")), false);
  });

  it("looks exactly where this platform's installer writes", () => {
    const candidates = install.shimCandidates();
    if (process.platform === "win32") {
      // One place: %LOCALAPPDATA%\Programs\VibeHub - per user, no administrator.
      assert.equal(candidates.length, 1);
      assert.ok(candidates[0].endsWith(join("Programs", "VibeHub", "vibehub-tracker.cmd")), candidates[0]);
      assert.ok(install.launcherDir().endsWith(join("Programs", "VibeHub")));
    } else {
      assert.equal(candidates.length, 2);
      assert.ok(candidates[0].startsWith(sandbox), "the user-level candidate must follow HOME");
      assert.ok(candidates[0].endsWith(join(".local", "bin", "vibehub-tracker")));
      assert.equal(candidates[1], "/usr/local/bin/vibehub-tracker");
    }
  });

  it("uses the same marker the installers write", () => {
    // The shells and this module must agree, or an installed shim becomes unremovable.
    const connect = readFileSync(resolve(__dirname, "../../web/public/tracker/connect.sh"), "utf8");
    assert.ok(connect.includes(`VIBEHUB_SHIM_MARK='${install.SHIM_MARK}'`));
  });
});

describe("hooks status: says what is wired and what is only half wired", () => {
  it("reports consent and registration independently", () => {
    installNow("cursor");
    install.setConsent(readConfig() as TrackerConfig, "cursor", true);
    // Consented, hook installed... but only half of Windsurf: a file that exists with no
    // entry of ours must not read as installed.
    seedVendorFile("windsurf", { hooks: { pre_user_prompt: [{ command: command("windsurf") }] } });
    install.setConsent(readConfig() as TrackerConfig, "windsurf", false);
    const [cursor, windsurf] = install.hookStatus(readConfig() as TrackerConfig, EXEC, SCRIPT);
    assert.deepEqual(cursor, {
      tool: "cursor", consented: true, file: install.hookFileFor("cursor"), fileExists: true,
      registered: ["afterAgentResponse", "stop"], missing: [], stale: [],
    });
    assert.deepEqual(windsurf, {
      tool: "windsurf", consented: false, file: install.hookFileFor("windsurf"), fileExists: true,
      registered: ["pre_user_prompt"], missing: ["post_cascade_response"], stale: [],
    });
  });

  it("reports an absent file without creating it, and never reads the inbox", () => {
    const [cursor] = install.hookStatus(baseConfig, EXEC, SCRIPT);
    assert.equal(cursor.fileExists, false);
    assert.deepEqual(cursor.registered, []);
    assert.equal(existsSync(cursor.file), false);
    const inbox = install.inboxPresence();
    assert.equal(inbox.exists, false);
    assert.ok(inbox.path.startsWith(sandbox));
  });
});

// ---- Round 6: what production verification caught ----

describe("leaving leaves nothing behind (F-D)", () => {
  it("puts the user's original bytes back, byte for byte", () => {
    // Four-space indent, no trailing newline, their own key order: a file they may well
    // have in Git. We are allowed to add one key and then to take it away again - we are
    // not allowed to hand the file back reformatted.
    const original = '{\n    "version": 1,\n    "hooks": {\n        "stop": []\n    }\n}';
    const file = install.hookFileFor("cursor");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, original);

    install.applyHookPlan(install.planHookInstall("cursor", command("cursor")));
    assert.notEqual(readFileSync(file, "utf8"), original, "install must have changed something");
    assert.equal(existsSync(install.backupPathFor("cursor")), true, "install takes one backup");

    install.applyHookPlan(install.planHookUninstall("cursor", command("cursor")));
    assert.equal(readFileSync(file, "utf8"), original, "uninstall restores the original bytes");
    assert.equal(existsSync(install.backupPathFor("cursor")), false, "and takes our backup with it");
  });

  it("keeps a file the user changed while we were installed, and still drops the backup", () => {
    const file = install.hookFileFor("windsurf");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ hooks: { pre_user_prompt: [] } }, null, 2));
    install.applyHookPlan(install.planHookInstall("windsurf", command("windsurf")));
    // The user adds a hook of their own after we installed ours.
    const mine = JSON.parse(readFileSync(file, "utf8")) as { hooks: Record<string, unknown[]> };
    mine.hooks.pre_user_prompt.push({ command: "my-own-tool" });
    writeFileSync(file, JSON.stringify(mine, null, 2));

    install.applyHookPlan(install.planHookUninstall("windsurf", command("windsurf")));
    const after = JSON.parse(readFileSync(file, "utf8")) as { hooks: Record<string, unknown[]> };
    assert.deepEqual(after.hooks.pre_user_prompt, [{ command: "my-own-tool" }], "their hook survives, ours is gone");
    assert.equal(existsSync(install.backupPathFor("windsurf")), false, "stale backup is not left behind");
  });

  it("cleans up a backup even when the uninstall has nothing left to change", () => {
    // Their own hook, none of ours: an uninstall with literally nothing to do. The
    // backup is a leftover from an earlier install, and it still has to go.
    const theirs = { hooks: { stop: [{ command: "my-own-tool" }] } };
    const file = install.hookFileFor("cursor");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(theirs, null, 2)}\n`);
    writeFileSync(install.backupPathFor("cursor"), `${JSON.stringify(theirs, null, 2)}\n`);
    const plan = install.planHookUninstall("cursor", command("cursor"));
    assert.equal(plan.changed, false, "nothing of ours is in the file");
    install.applyHookPlan(plan);
    assert.equal(existsSync(install.backupPathFor("cursor")), false);
  });
});

describe("the first event counts (F-G)", () => {
  it("creates the inbox empty at consent time, so first sight is not first record", () => {
    assert.equal(install.inboxPresence().exists, false);
    assert.equal(ensureInboxExists(), true);
    const inbox = install.inboxPresence();
    assert.equal(inbox.exists, true);
    assert.equal(inbox.records, 0, "empty: the receiver primes here and misses nothing");
  });

  it("never disturbs an inbox that already holds records", () => {
    const line = `${JSON.stringify({ tool: "cursor", at: "2026-09-21T10:00:00.000Z" })}\n`;
    writeFileSync(install.inboxPresence().path, line);
    assert.equal(ensureInboxExists(), true);
    assert.equal(readFileSync(install.inboxPresence().path, "utf8"), line, "history is left exactly as it was");
  });
});

describe("hooks status can tell idle from broken (F-F)", () => {
  it("separates never-fired, fired-once and oversized", () => {
    assert.deepEqual(
      [install.inboxPresence().exists, install.inboxPresence().records],
      [false, null],
      "absent inbox reports nothing rather than zero"
    );

    ensureInboxExists();
    assert.equal(install.inboxPresence().records, 0, "created but idle");

    const record = `${JSON.stringify({ tool: "cursor", at: "2026-09-21T10:00:00.000Z" })}\n`;
    writeFileSync(install.inboxPresence().path, record.repeat(3));
    const busy = install.inboxPresence();
    assert.equal(busy.records, 3);
    assert.ok(busy.lastWriteMs !== null && busy.lastWriteMs > 0, "and when the last one arrived");
    assert.equal(busy.oversized, false);
  });

  it("says a file the daemon will not read is oversized, instead of counting it", () => {
    // Past the receiver's own 32 MB bound. Grown by truncate rather than by writing the
    // bytes, so the test stays fast and the point is the size, not the content.
    const path = install.inboxPresence().path;
    ensureInboxExists();
    truncateSync(path, 33 * 1024 * 1024);
    const presence = install.inboxPresence();
    assert.equal(presence.oversized, true);
    assert.equal(presence.records, null, "a count nobody consumes would be a lie");
  });
});

process.on("exit", () => { rmSync(sandbox, { recursive: true, force: true }); });
