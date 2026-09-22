// Autostart: `vibehub-tracker start` leaves the tracker registered to start again at the
// next login, and it stays that way until the user says otherwise.
//
// What these checks defend:
//   - the artifact is the documented USER-scope mechanism on each platform, and nothing
//     more: no elevation, no system-wide daemon, no registry, no second copy anywhere;
//   - the macOS plist matches what the Mac app writes, key for key, including the
//     `KeepAlive { SuccessfulExit: false }` that keeps a deliberate exit from becoming a
//     permanent 30 s relaunch loop;
//   - a registration this install did not write is reported, never overwritten or removed;
//   - `disable` means something: it is recorded, and `start` honours it;
//   - a failed registration leaves nothing behind that would claim otherwise.
//
// SAFETY: HOME/USERPROFILE/APPDATA/XDG_CONFIG_HOME are redirected to a throwaway directory
// BEFORE any tracker module is required, and both the redirect and the resolved autostart
// path are asserted - so the developer's real `~/.vibehub`, real Startup folder and real
// ~/Library/LaunchAgents are never read or written. `launchctl` is never executed: the
// activation runner is injected, so the cases assert the exact argv instead of running it.
// No daemon is started, no process is spawned, nothing leaves the machine.

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { beforeEach, describe, it } from "node:test";

const tempRoot = resolve(__dirname, "../../../.temp/vibehub-ai-only");
mkdirSync(tempRoot, { recursive: true });
const sandbox = mkdtempSync(join(tempRoot, "autostart-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.HOMEDRIVE = sandbox.slice(0, 2);
process.env.HOMEPATH = sandbox.slice(2);
// Windows resolves the Startup folder through APPDATA and Linux the autostart directory
// through XDG_CONFIG_HOME. Both are pinned inside the sandbox, or this file would write a
// real login item on the machine running the tests.
process.env.APPDATA = join(sandbox, "AppData", "Roaming");
process.env.XDG_CONFIG_HOME = join(sandbox, ".config");

const { CONFIG_DIR } = require("../src/paths") as typeof import("../src/paths");
if (!CONFIG_DIR.startsWith(sandbox)) {
  throw new Error(`refusing to run: the tracker resolves ${CONFIG_DIR}, not the sandbox ${sandbox}`);
}
const autostart = require("../src/autostart") as typeof import("../src/autostart");
const { autostartOptedOut, projectAutostart, readConfig, setAutostartPreference, writeConfig } =
  require("../src/config") as typeof import("../src/config");
import type { AutostartEnv, AutostartRunner } from "../src/autostart";
import type { TrackerConfig } from "../src/types";

{
  // The second belt: whatever this host is, the file this suite would touch is inside the
  // sandbox. A missing APPDATA/XDG redirect would show up here rather than in the user's
  // Startup folder.
  const live = autostart.autostartFile(autostart.hostEnv(join(sandbox, "app", "vibehub-tracker.cjs")));
  if (live !== null && !live.startsWith(sandbox)) {
    throw new Error(`refusing to run: autostart resolves ${live}, outside the sandbox ${sandbox}`);
  }
}

const NODE = process.platform === "win32" ? "C:\\Program Files\\nodejs\\node.exe" : "/usr/local/bin/node";
const SCRIPT = join(sandbox, "app", "vibehub-tracker.cjs");

const envFor = (platform: NodeJS.Platform, over: Partial<AutostartEnv> = {}): AutostartEnv => ({
  platform,
  home: sandbox,
  execPath: NODE,
  scriptPath: SCRIPT,
  appData: join(sandbox, "AppData", "Roaming"),
  ...over,
});

/** Records every `launchctl` invocation instead of performing it. */
function recorder(outcome: (args: string[]) => { ok: boolean; detail: string } = () => ({ ok: true, detail: "" })) {
  const calls: string[][] = [];
  const run: AutostartRunner = (file, args) => {
    calls.push([file, ...args]);
    return outcome(args);
  };
  return { calls, run };
}

const baseConfig: TrackerConfig = {
  apiUrl: "https://tracker-fixture.invalid",
  deviceToken: "SYNTHETIC_ONLY_NOT_A_CREDENTIAL",
  projectAliases: {},
};

const enableNow = (env: AutostartEnv, run?: AutostartRunner, activate = false) =>
  autostart.applyAutostartPlan(autostart.planAutostartEnable(env), { runner: run ?? recorder().run, activate });

const readArtifact = (env: AutostartEnv): string => {
  const file = autostart.autostartFile(env);
  assert.ok(file !== null);
  const raw = readFileSync(file);
  return raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe
    ? raw.subarray(2).toString("utf16le")
    : raw.toString("utf8");
};

/**
 * A Desktop Entry escapes `"`, backtick, `$` and backslash inside `Exec`. Unescaping is how
 * these cases check the quoting is REVERSIBLE - asserting on a re-escaped string here would
 * only be re-implementing the thing under test.
 */
const execArguments = (entry: string): string[] => {
  const line = /^Exec=(.*)$/m.exec(entry)?.[1] ?? "";
  return (line.match(/"(?:\\.|[^"\\])*"|\S+/g) ?? [])
    .map((token) => token.startsWith('"') ? token.slice(1, -1).replace(/\\(.)/g, "$1") : token);
};

const wipe = (): void => {
  // The directories go too, so "reading never writes" can assert that nothing created one.
  for (const platform of ["darwin", "linux", "win32"] as const) {
    const file = autostart.autostartFile(envFor(platform));
    if (file !== null) rmSync(dirname(file), { recursive: true, force: true });
  }
  rmSync(CONFIG_DIR, { recursive: true, force: true });
};

beforeEach(() => {
  wipe();
  writeConfig(baseConfig);
});

describe("the artifact is the documented user-scope mechanism, per platform", () => {
  it("macOS: ~/Library/LaunchAgents/com.vibehub.tracker.plist running `serve`", () => {
    const env = envFor("darwin");
    assert.equal(autostart.autostartFile(env), join(sandbox, "Library", "LaunchAgents", "com.vibehub.tracker.plist"));
    const plist = autostart.renderAutostart(env)?.text ?? "";
    assert.ok(plist.includes("<key>Label</key>\n  <string>com.vibehub.tracker</string>"), plist);
    assert.ok(plist.includes(`<string>${NODE}</string>\n    <string>${SCRIPT}</string>\n    <string>serve</string>`), plist);
    assert.ok(plist.includes("<key>RunAtLoad</key>\n  <true/>"), "RunAtLoad is what makes it start at login");
    assert.ok(plist.includes("<key>ThrottleInterval</key>\n  <integer>30</integer>"));
    assert.ok(plist.includes("<key>ProcessType</key>\n  <string>Background</string>"));
    assert.ok(plist.includes(`<key>HOME</key>\n    <string>${sandbox}</string>`), "HOME is stated, not assumed");
    assert.equal((plist.match(/launchd\.log/g) ?? []).length, 2, "stdout and stderr both go to launchd.log");
    assert.ok(plist.includes(autostart.AUTOSTART_MARK), "the file must say who wrote it");
  });

  it("macOS: KeepAlive is failure-only - plain `true` would relaunch every deliberate exit", () => {
    const plist = autostart.renderAutostart(envFor("darwin"))?.text ?? "";
    assert.ok(plist.includes("<key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>"), plist);
    assert.equal(/<key>KeepAlive<\/key>\s*<true\/>/.test(plist), false, "KeepAlive: true is the relaunch-loop bug");
  });

  it("macOS: agrees with the Mac app's own LaunchAgent, which writes the same label", () => {
    // The two can never both register, because they would write the same file. They must
    // therefore also agree about what that file says - this is the only place that can
    // notice the Swift and the TypeScript drifting apart.
    const swift = resolve(__dirname, "../../mac/Sources/VibeHub/LaunchAgent.swift");
    if (!existsSync(swift)) return; // tracker checked out on its own
    const source = readFileSync(swift, "utf8");
    assert.ok(source.includes(`static let label = "${autostart.LAUNCH_AGENT_LABEL}"`), "the labels have diverged");
    assert.ok(source.includes('"KeepAlive": ["SuccessfulExit": false]'), "the KeepAlive contract has diverged");
    assert.ok(source.includes('"ThrottleInterval": 30'), "the throttle interval has diverged");
    assert.ok(/ProgramArguments": \[nodePath, cjsPath, "serve"\]/.test(source), "the Mac app no longer runs `serve`");
  });

  it("Linux: an XDG autostart entry, honouring XDG_CONFIG_HOME", () => {
    const env = envFor("linux");
    assert.equal(autostart.autostartFile(env), join(sandbox, ".config", "autostart", "vibehub-tracker.desktop"));
    assert.equal(
      autostart.autostartFile(envFor("linux", { configHome: "/opt/cfg" })),
      join("/opt/cfg", "autostart", "vibehub-tracker.desktop"));
    // A relative value is not a config home; the specification says fall back to ~/.config.
    assert.equal(
      autostart.autostartFile(envFor("linux", { configHome: "relative/cfg" })),
      join(sandbox, ".config", "autostart", "vibehub-tracker.desktop"));

    const entry = autostart.renderAutostart(env)?.text ?? "";
    assert.ok(entry.startsWith("[Desktop Entry]\n"), entry);
    assert.ok(entry.includes("Type=Application"));
    assert.deepEqual(execArguments(entry), [NODE, SCRIPT, "serve"], entry);
    // `Hidden=true` means DISABLED in the autostart specification, not "no icon".
    assert.ok(entry.includes("Hidden=false"));
    assert.ok(entry.includes("NoDisplay=true"));
    assert.ok(entry.includes("X-GNOME-Autostart-enabled=true"));
    assert.ok(entry.includes(`# ${autostart.AUTOSTART_MARK}`));
  });

  it("Linux: quotes a path with spaces, quotes or a dollar sign so it survives the launcher", () => {
    for (const awkward of ["My Apps/vibe hub", "cash$dir", 'quote"dir', "back\\slash"]) {
      const script = `/home/dev/${awkward}/vibehub-tracker.cjs`;
      const entry = autostart.renderAutostart(envFor("linux", { scriptPath: script }))?.text ?? "";
      assert.deepEqual(execArguments(entry), [NODE, script, "serve"], entry);
      // Each of these is a metacharacter to the thing that reads Exec, so each must have
      // been escaped rather than merely wrapped in quotes.
      const raw = /^Exec=(.*)$/m.exec(entry)?.[1] ?? "";
      for (const special of ["$", '"', "\\"]) {
        if (script.includes(special)) assert.ok(raw.includes(`\\${special}`), `${special} was not escaped in ${raw}`);
      }
    }
  });

  it("Windows: a Startup-folder script that runs wscript-hidden, not a console window", () => {
    const env = envFor("win32");
    assert.equal(autostart.autostartFile(env),
      join(sandbox, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "VibeHub Tracker.vbs"));
    const vbs = autostart.renderAutostart(env)?.text ?? "";
    // 0 = hidden window, False = do not wait. This is the whole reason it is a .vbs.
    assert.ok(vbs.includes('shell.Run """" & node & """ """ & script & """ serve", 0, False'), vbs);
    assert.ok(vbs.includes('CreateObject("WScript.Shell")'));
    assert.ok(vbs.includes(`' ${autostart.AUTOSTART_MARK}`));
    assert.ok(vbs.includes("\r\n"), "a .vbs is read line by line by wscript; keep CRLF");
    assert.equal(autostart.renderAutostart(env)?.encoding, "utf8");
  });

  it("Windows: embeds %USERPROFILE%, so a non-ASCII home survives the ANSI code page", () => {
    // Measured on the launcher before this: a `C:\Users\Пример` path written literally into
    // a .vbs is read in the machine's code page and arrives mangled, so nothing starts.
    const home = join(sandbox, "Ünïcødé Пример");
    const env = envFor("win32", { home, scriptPath: join(home, ".vibehub", "app", "vibehub-tracker.cjs"),
      appData: join(home, "AppData", "Roaming") });
    const rendered = autostart.renderAutostart(env);
    assert.ok(rendered !== null);
    assert.ok(rendered.text.includes('%USERPROFILE%\\.vibehub\\app\\vibehub-tracker.cjs'), rendered.text);
    assert.equal(rendered.text.includes("Пример"), false, "a non-ASCII path was embedded literally");
    // eslint-disable-next-line no-control-regex
    assert.equal(/[^\x00-\x7F]/.test(rendered.text), false, "the script is not pure ASCII");
    assert.equal(rendered.encoding, "utf8");
  });

  it("Windows: falls back to UTF-16 when a path OUTSIDE the home is still non-ASCII", () => {
    const env = envFor("win32", { execPath: "C:\\Программы\\node.exe" });
    const rendered = autostart.renderAutostart(env);
    assert.equal(rendered?.encoding, "utf16le", "wscript could not read that in the ANSI code page");
    autostart.applyAutostartPlan(autostart.planAutostartEnable(env));
    const raw = readFileSync(autostart.autostartFile(env) as string);
    assert.deepEqual([raw[0], raw[1]], [0xff, 0xfe], "a UTF-16 .vbs needs its BOM or wscript misreads it");
    assert.ok(readArtifact(env).includes("C:\\Программы\\node.exe"));
    // ...and it is still recognised as ours when read back, BOM and all.
    assert.equal(autostart.autostartStatus(env, false).owner, "ours");
  });

  it("every platform launches `serve`, never `start`", () => {
    // `start` self-detaches and returns, which is a crash to a supervisor and an
    // unsupervisable grandchild to everyone else. `serve` owns tracker.pid in this process.
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const text = autostart.renderAutostart(envFor(platform))?.text ?? "";
      assert.ok(text.includes("serve"), platform);
      assert.equal(/\brun-loop\b/.test(text), false, `${platform} must not run the internal loop directly`);
    }
  });

  it("says so honestly on a platform it has no mechanism for", () => {
    const env = envFor("freebsd");
    assert.equal(autostart.autostartFile(env), null);
    assert.equal(autostart.autostartSupported(env), false);
    assert.equal(autostart.renderAutostart(env), null);
    const plan = autostart.planAutostartEnable(env);
    assert.equal(plan.supported, false);
    assert.ok(plan.blocked?.includes("freebsd"), plan.blocked ?? "");
    assert.equal(autostart.ensureAutostart(env, false).outcome, "unsupported");
    // And it writes nothing at all rather than half a registration somewhere.
    assert.deepEqual(autostart.applyAutostartPlan(plan), { plan, wrote: false, removed: false, activation: "not-needed", detail: null });
  });
});

describe("enable, disable, and the file on disk", () => {
  for (const platform of ["darwin", "linux", "win32"] as const) {
    it(`${platform}: writes it, is idempotent, and removes exactly what it wrote`, () => {
      const env = envFor(platform);
      const file = autostart.autostartFile(env) as string;
      assert.equal(existsSync(file), false);

      const first = enableNow(env);
      assert.equal(first.wrote, true);
      assert.equal(readArtifact(env), autostart.renderAutostart(env)?.text);

      // Running it again changes nothing - `start` calls this every time.
      const second = autostart.planAutostartEnable(env);
      assert.equal(second.changed, false);
      assert.equal(second.owner, "ours");
      assert.equal(autostart.applyAutostartPlan(second, { runner: recorder().run }).wrote, false);

      const state = autostart.autostartStatus(env, false);
      assert.deepEqual(
        [state.supported, state.exists, state.owner, state.current, state.optedOut, state.problem],
        [true, true, "ours", true, false, null]);

      const off = autostart.applyAutostartPlan(autostart.planAutostartDisable(env), { runner: recorder().run });
      assert.equal(off.removed, true);
      assert.equal(existsSync(file), false);
      assert.equal(autostart.autostartStatus(env, false).exists, false);
      // No temporary file is left behind by the atomic write.
      assert.deepEqual(readdirSync(dirname(file)).filter((name) => name.includes(".tmp")), []);
    });
  }

  it("rewrites an entry that points at an older install, rather than adding a second one", () => {
    // There is one login entry per user at this path, so the tracker the user most
    // recently started is the one it should name - the rule `hooks install` already
    // applies to a hook command whose tracker moved.
    const env = envFor("linux");
    const moved = envFor("linux", { scriptPath: join(sandbox, "old-app", "vibehub-tracker.cjs") });
    enableNow(moved);
    const plan = autostart.planAutostartEnable(env);
    assert.equal(plan.owner, "other-install");
    assert.equal(plan.blocked, null, "a stale entry at our own path is ours to refresh");
    assert.equal(plan.changed, true);
    assert.equal(autostart.autostartStatus(env, false).current, false);
    autostart.applyAutostartPlan(plan);
    assert.deepEqual(execArguments(readArtifact(env)), [NODE, SCRIPT, "serve"]);
    assert.equal(readArtifact(env).includes("old-app"), false, "the old entry was left behind");
    assert.equal(autostart.autostartStatus(env, false).current, true);
  });

  it("refuses to REMOVE an entry that points at a tracker installed elsewhere", () => {
    // Refreshing it is one thing; taking it away on someone else's behalf would silently
    // stop their tracker coming back, which `uninstall` has no business doing.
    const env = envFor("linux");
    enableNow(envFor("linux", { scriptPath: join(sandbox, "other-install", "vibehub-tracker.cjs") }));
    const plan = autostart.planAutostartDisable(env);
    assert.equal(plan.owner, "other-install");
    assert.ok(plan.blocked?.includes("installed elsewhere"), plan.blocked ?? "");
    assert.ok(plan.blocked?.includes("other-install"), "the refusal should name the install it found");
    autostart.applyAutostartPlan(plan, { runner: recorder().run });
    assert.equal(existsSync(autostart.autostartFile(env) as string), true);
    assert.equal(autostart.removeAutostartQuietly(env, { runner: recorder().run }), null);
    assert.equal(existsSync(autostart.autostartFile(env) as string), true);
  });

  it("a disable with nothing registered is a no-op, not an error", () => {
    const env = envFor("linux");
    const plan = autostart.planAutostartDisable(env);
    assert.equal(plan.changed, false);
    assert.equal(plan.existed, false);
    const applied = autostart.applyAutostartPlan(plan, { runner: recorder().run });
    assert.equal(applied.removed, false);
  });
});

describe("somebody else's file is never overwritten", () => {
  const seed = (env: AutostartEnv, body: string): string => {
    const file = autostart.autostartFile(env) as string;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
    return file;
  };

  it("leaves a file without our marker completely alone, both ways", () => {
    for (const platform of ["linux", "win32"] as const) {
      const env = envFor(platform);
      const body = "someone else's autostart entry\n";
      const file = seed(env, body);

      const enable = autostart.planAutostartEnable(env);
      assert.equal(enable.owner, "foreign");
      assert.ok(enable.blocked?.includes("not written by VibeHub"), enable.blocked ?? "");
      assert.equal(enable.changed, false);
      autostart.applyAutostartPlan(enable, { runner: recorder().run });

      const disable = autostart.planAutostartDisable(env);
      assert.equal(disable.owner, "foreign");
      autostart.applyAutostartPlan(disable, { runner: recorder().run });

      assert.equal(readFileSync(file, "utf8"), body, `${platform}: a stranger's file was touched`);
      assert.equal(autostart.ensureAutostart(env, false).outcome, "blocked");
    }
  });

  it("leaves the Mac app's LaunchAgent alone - same label, different install", () => {
    // Exactly what `mac/Sources/VibeHub/LaunchAgent.swift` writes: our label, pointing at
    // the tracker inside the app bundle. A terminal install must not hijack it.
    const env = envFor("darwin");
    const theirs = autostart.renderAutostart(envFor("darwin", {
      scriptPath: "/Applications/VibeHub.app/Contents/Resources/tracker/vibehub-tracker.cjs",
    }))?.text ?? "";
    const file = seed(env, theirs);

    const plan = autostart.planAutostartEnable(env);
    assert.equal(plan.owner, "other-install");
    assert.ok(plan.blocked?.includes("belongs to the VibeHub app"), plan.blocked ?? "");
    assert.ok(plan.blocked?.includes("Track at login"), "point the user at the switch that owns it");
    const runner = recorder();
    autostart.applyAutostartPlan(plan, { runner: runner.run });
    assert.deepEqual(runner.calls, [], "launchctl must not be touched for a plist that is not ours");
    assert.equal(readFileSync(file, "utf8"), theirs);

    // ...and `uninstall`/`logout` do not rip out the app's login item either.
    assert.equal(autostart.removeAutostartQuietly(env, { runner: runner.run }), null);
    assert.equal(readFileSync(file, "utf8"), theirs);
    assert.equal(autostart.autostartStatus(env, false).owner, "other-install");
  });

  it("refuses a symlinked registration instead of writing through it", (t) => {
    const env = envFor("linux");
    const file = autostart.autostartFile(env) as string;
    const target = join(sandbox, "symlink-target.desktop");
    writeFileSync(target, "[Desktop Entry]\n");
    mkdirSync(dirname(file), { recursive: true });
    try { symlinkSync(target, file, "file"); }
    catch { return t.skip("this platform does not allow creating symlinks unprivileged"); }

    assert.throws(() => autostart.planAutostartEnable(env), autostart.AutostartError);
    assert.throws(() => autostart.planAutostartDisable(env), autostart.AutostartError);
    assert.equal(readFileSync(target, "utf8"), "[Desktop Entry]\n");
    // The CLI turns that into one sentence and a non-zero exit; nothing is written.
    assert.equal(autostart.ensureAutostart(env, false).outcome, "failed");
    assert.equal(autostart.autostartStatus(env, false).problem !== null, true);
    rmSync(file, { force: true });
  });
});

describe("macOS registration goes through launchctl, in the right order", () => {
  const domain = `gui/${process.getuid?.() ?? 0}`;

  it("boots out a stale job, bootstraps the new plist, and only kickstarts when asked", () => {
    const env = envFor("darwin");
    const quiet = recorder();
    const applied = enableNow(env, quiet.run, false);
    assert.equal(applied.activation, "loaded");
    assert.deepEqual(quiet.calls, [
      ["/bin/launchctl", "bootout", `${domain}/com.vibehub.tracker`],
      ["/bin/launchctl", "bootstrap", domain, autostart.autostartFile(env)],
    ], "start must not force a restart of the daemon it just started");

    rmSync(autostart.autostartFile(env) as string, { force: true });
    const loud = recorder();
    enableNow(env, loud.run, true);
    assert.deepEqual(loud.calls[2], ["/bin/launchctl", "kickstart", "-k", `${domain}/com.vibehub.tracker`],
      "`autostart enable` on its own should start it now");
  });

  it("rolls the plist back when launchd refuses it, so status cannot lie", () => {
    const env = envFor("darwin");
    const refuse = recorder((args) => args[0] === "bootstrap"
      ? { ok: false, detail: "Load failed: 5: Input/output error" }
      : { ok: true, detail: "" });
    const applied = autostart.applyAutostartPlan(autostart.planAutostartEnable(env), { runner: refuse.run });
    assert.equal(applied.activation, "failed");
    assert.equal(applied.wrote, false);
    assert.ok(applied.detail?.includes("Load failed"), applied.detail ?? "");
    assert.equal(existsSync(autostart.autostartFile(env) as string), false, "a plist launchd never took was left behind");
    assert.equal(autostart.autostartStatus(env, false).exists, false);
  });

  it("boots the job out before deleting the plist, or it would keep running", () => {
    const env = envFor("darwin");
    enableNow(env);
    const runner = recorder();
    const applied = autostart.applyAutostartPlan(autostart.planAutostartDisable(env), { runner: runner.run });
    assert.deepEqual(runner.calls, [["/bin/launchctl", "bootout", `${domain}/com.vibehub.tracker`]]);
    assert.equal(applied.removed, true);
    assert.equal(existsSync(autostart.autostartFile(env) as string), false);
  });

  it("never runs launchctl on the platforms that do not have it", () => {
    for (const platform of ["linux", "win32"] as const) {
      const runner = recorder();
      enableNow(envFor(platform), runner.run, true);
      autostart.applyAutostartPlan(autostart.planAutostartDisable(envFor(platform)), { runner: runner.run });
      assert.deepEqual(runner.calls, [], platform);
      // The file IS the registration on these two: it takes effect at the next login.
      assert.equal(enableNow(envFor(platform), runner.run).activation, "not-needed");
    }
  });
});

describe("`start` registers it, and an explicit `disable` survives that", () => {
  it("registers on the first start and says nothing new on the next", () => {
    const env = envFor("linux");
    assert.deepEqual(autostart.ensureAutostart(env, false, { runner: recorder().run }),
      { outcome: "registered", file: autostart.autostartFile(env), detail: null });
    assert.deepEqual(autostart.ensureAutostart(env, false, { runner: recorder().run }),
      { outcome: "already", file: autostart.autostartFile(env), detail: null });
  });

  it("does not put back a registration the user removed by hand while opted out", () => {
    const env = envFor("linux");
    const report = autostart.ensureAutostart(env, true, { runner: recorder().run });
    assert.equal(report.outcome, "opted-out");
    assert.equal(existsSync(autostart.autostartFile(env) as string), false, "`start` re-registered over an opt-out");
  });

  it("records the opt-out in config.json, which is what `start` reads", () => {
    assert.equal(autostartOptedOut(readConfig()), false, "absent means never asked, not opted out");
    setAutostartPreference(readConfig() as TrackerConfig, false);
    assert.deepEqual(readConfig()?.autostart, { enabled: false });
    assert.equal(autostartOptedOut(readConfig()), true);
    setAutostartPreference(readConfig() as TrackerConfig, true);
    assert.equal(autostartOptedOut(readConfig()), false);
  });

  it("keeps the preference through a re-login, and rejects a shape it cannot read", () => {
    // `login` carries the field across so a re-install cannot quietly undo a `disable`.
    const stored = { ...baseConfig, autostart: { enabled: false } };
    writeConfig(stored);
    assert.deepEqual(readConfig()?.autostart, { enabled: false });
    assert.deepEqual(projectAutostart(undefined), null);
    assert.deepEqual(projectAutostart({ enabled: true }), { enabled: true });
    for (const bad of [{ enabled: "yes" }, { enabled: true, extra: 1 }, {}, [], "on", 1, null]) {
      assert.equal(projectAutostart(bad), "invalid", JSON.stringify(bad));
    }
  });

  it("removing it for `logout` takes the file with it and leaves nothing loaded", () => {
    const env = envFor("darwin");
    enableNow(env);
    const runner = recorder();
    assert.equal(autostart.removeAutostartQuietly(env, { runner: runner.run }), autostart.autostartFile(env));
    assert.equal(existsSync(autostart.autostartFile(env) as string), false);
    assert.deepEqual(runner.calls, [["/bin/launchctl", "bootout", `gui/${process.getuid?.() ?? 0}/com.vibehub.tracker`]]);
    // Nothing registered: silent, and not an error.
    assert.equal(autostart.removeAutostartQuietly(env, { runner: runner.run }), null);
  });
});

describe("reading never writes", () => {
  it("`autostart status` creates no file, no directory and no state", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const env = envFor(platform);
      const state = autostart.autostartStatus(env, false);
      assert.equal(state.exists, false);
      assert.equal(state.owner, "none");
      assert.ok(state.command.includes("serve"));
      assert.equal(existsSync(autostart.autostartFile(env) as string), false);
      assert.equal(existsSync(dirname(autostart.autostartFile(env) as string)), false, `${platform}: status created a directory`);
    }
  });
});

process.on("exit", () => { rmSync(sandbox, { recursive: true, force: true }); });
