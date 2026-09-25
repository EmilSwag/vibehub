import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Autostart: after the user has started the tracker once, it comes back by itself at the
 * next login or reboot, and stays that way until they turn it off.
 *
 * What triggers it is `start`, never an installer. `install.{ps1,sh}` and
 * `connect.{ps1,sh}` are setup-only by a contract that exists because an earlier installer
 * was classified as unauthorized persistence (`meta/plans/vibehub-tracker-explicit-start.md`),
 * and `web/scripts/test-installers.mjs` fails the moment a LaunchAgent, a .plist, a Startup
 * entry or a .lnk appears after an install run. Installing still registers nothing. The user
 * starting a background tracker is the consent event, and this is what it is consented to.
 *
 * Three properties hold on every platform:
 *   - user scope only. No `sudo`, no elevation, no system-wide LaunchDaemon, no HKLM,
 *     nothing that touches another account on the machine.
 *   - one visible file the user can delete by hand, in the place their OS documents for
 *     exactly this. `autostart status` prints its path; `autostart disable` removes it.
 *   - nothing hidden. The artifact names the tracker, carries a marker saying who wrote it
 *     and that it is safe to delete, and is never obfuscated or re-created behind the user's
 *     back: an explicit `disable` is recorded in config.json and `start` honours it.
 *
 * What the OS launches is `serve`, not `start`: it runs the loop in *this* process rather
 * than self-detaching (a detached grandchild is a process a supervisor cannot see), it owns
 * `tracker.pid` directly, and it already knows how to defer to or cooperatively take over a
 * daemon it finds running (see staleDaemon.ts).
 *
 * The artifacts, each the documented per-user mechanism for its platform:
 *   macOS    ~/Library/LaunchAgents/com.vibehub.tracker.plist   launchd, RunAtLoad
 *   Linux    ~/.config/autostart/vibehub-tracker.desktop        XDG autostart
 *   Windows  %APPDATA%\...\Startup\VibeHub Tracker.vbs          Startup folder
 *
 * Windows takes a file in the Startup folder rather than an HKCU\...\Run value on purpose:
 * a file is visible in Explorer, removable without regedit, and - the deciding reason -
 * sandboxable, so the tests below run against a throwaway %APPDATA% instead of writing to
 * the developer's real registry. It is a `.vbs` because Startup runs it through `wscript`,
 * which is a GUI-subsystem host: `node.exe` launched any other way flashes a console window
 * at every single login.
 */

/** Same label the Mac app's LaunchAgent.swift writes, so the two can never both register. */
export const LAUNCH_AGENT_LABEL = "com.vibehub.tracker";

/**
 * The marker every artifact carries, in that platform's own comment syntax. It is how
 * `disable` and `status` tell a file this install wrote from one that merely shares its
 * name - the same contract `SHIM_MARK` provides for the `vibehub-tracker` command.
 */
export const AUTOSTART_MARK = "vibehub-tracker autostart v1 (managed by VibeHub; safe to delete)";

/** A registration file is a few hundred bytes; anything past this is not ours to rewrite. */
const MAX_AUTOSTART_BYTES = 64 * 1024;

/** launchd's own throttle, matched to the tracker's heartbeat cadence (LaunchAgent.swift). */
const THROTTLE_INTERVAL_SECONDS = 30;

export class AutostartError extends Error {}

/**
 * Everything the artifact is rendered from, passed in rather than read from the process, so
 * all three platforms can be rendered and asserted from any one host. `hostEnv` builds the
 * real one.
 */
export interface AutostartEnv {
  platform: NodeJS.Platform;
  home: string;
  /** The node binary that will run the tracker. */
  execPath: string;
  /** The tracker entry point (`vibehub-tracker.cjs`, or dist/index.js in a checkout). */
  scriptPath: string;
  /** Windows: %APPDATA%. Ignored elsewhere. */
  appData?: string;
  /** Linux: $XDG_CONFIG_HOME. Ignored elsewhere. */
  configHome?: string;
}

export function hostEnv(scriptPath: string): AutostartEnv {
  return {
    platform: process.platform,
    home: os.homedir(),
    execPath: process.execPath,
    scriptPath,
    appData: process.env.APPDATA,
    configHome: process.env.XDG_CONFIG_HOME,
  };
}

/** Where this platform's autostart entry lives, or null where we have no mechanism. */
export function autostartFile(env: AutostartEnv): string | null {
  switch (env.platform) {
    case "darwin":
      return path.join(env.home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
    case "linux": {
      const configHome = env.configHome && path.isAbsolute(env.configHome)
        ? env.configHome
        : path.join(env.home, ".config");
      return path.join(configHome, "autostart", "vibehub-tracker.desktop");
    }
    case "win32": {
      const appData = env.appData && path.isAbsolute(env.appData)
        ? env.appData
        : path.join(env.home, "AppData", "Roaming");
      return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "VibeHub Tracker.vbs");
    }
    default:
      return null;
  }
}

export function autostartSupported(env: AutostartEnv): boolean {
  return autostartFile(env) !== null;
}

const shellQuote = (value: string): string =>
  /^[A-Za-z0-9_./\\:-]+$/.test(value) ? value : `"${value}"`;

/** What the OS will run, for `status` to print. Display only - never executed from here. */
export function autostartCommand(env: AutostartEnv): string {
  return `${shellQuote(env.execPath)} ${shellQuote(env.scriptPath)} serve`;
}

// ---------------------------------------------------------------------------
// Rendering. Pure: a platform plus four strings in, the exact bytes out.
// ---------------------------------------------------------------------------

/** Only these three are special inside a plist `<string>`. */
const xmlText = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Key for key what `mac/Sources/VibeHub/LaunchAgent.swift` writes, including the two that
 * are easy to get wrong:
 *
 *   KeepAlive: {SuccessfulExit: false} - not `true`. `true` relaunches EVERY exit, including
 *   the deliberate ones: `serve` exiting 0 because a healthy tracker already holds the lock,
 *   or because the user stopped it. Under `true` each becomes a permanent 30 s relaunch loop.
 *   `{SuccessfulExit: false}` means "keep it alive only while it is not exiting cleanly", so
 *   exit 0 is left alone and only a genuine crash is restarted.
 *
 *   EnvironmentVariables.HOME - a GUI agent normally inherits it, but every path the tracker
 *   touches is resolved from `os.homedir()`, so it is stated rather than assumed.
 */
function renderLaunchAgent(env: AutostartEnv): string {
  const log = path.join(env.home, ".vibehub", "launchd.log");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    `<!-- ${AUTOSTART_MARK} -->`,
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${xmlText(LAUNCH_AGENT_LABEL)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${xmlText(env.execPath)}</string>`,
    `    <string>${xmlText(env.scriptPath)}</string>`,
    "    <string>serve</string>",
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>ThrottleInterval</key>",
    `  <integer>${THROTTLE_INTERVAL_SECONDS}</integer>`,
    "  <key>ProcessType</key>",
    "  <string>Background</string>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>HOME</key>",
    `    <string>${xmlText(env.home)}</string>`,
    "  </dict>",
    "  <key>StandardOutPath</key>",
    `  <string>${xmlText(log)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlText(log)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

/**
 * Desktop Entry `Exec` quoting, per the freedesktop specification: an argument may be
 * wrapped in double quotes, inside which `"`, backtick, `$` and backslash are escaped with
 * a backslash. Paths with spaces are the whole reason this is not string concatenation.
 */
const desktopArg = (value: string): string => `"${value.replace(/["`$\\]/g, (c) => `\\${c}`)}"`;

/**
 * `Hidden=false` is load-bearing: in the XDG autostart specification `Hidden=true` does not
 * mean "no icon", it means "this entry is disabled". `NoDisplay=true` is the one that keeps
 * it out of menus. `X-GNOME-Autostart-enabled` is GNOME's own switch, which its Tweaks UI
 * flips rather than deleting the file.
 */
function renderDesktopEntry(env: AutostartEnv): string {
  return [
    "[Desktop Entry]",
    `# ${AUTOSTART_MARK}`,
    "Type=Application",
    "Version=1.0",
    "Name=VibeHub Tracker",
    "Comment=Sends AI-session metadata heartbeats. Delete this file to stop it starting at login.",
    `Exec=${desktopArg(env.execPath)} ${desktopArg(env.scriptPath)} serve`,
    "Terminal=false",
    "NoDisplay=true",
    "X-GNOME-Autostart-enabled=true",
    "Hidden=false",
    "",
  ].join("\n");
}

/**
 * `%USERPROFILE%\...` rather than the absolute path, for anything under the home directory.
 *
 * Exactly the technique `connect.ps1`'s launcher uses and for the same measured reason: a
 * `.vbs` is read by `wscript` in the machine's ANSI code page unless it carries a UTF-16
 * BOM, so a home directory like `C:\Users\Пример` embedded literally arrives mangled and the
 * tracker never starts. Expanding the variable at run time keeps the common case pure ASCII.
 */
function userProfileRelative(value: string, home: string): string {
  const root = home.replace(/[\\/]+$/, "");
  if (!value.toLowerCase().startsWith(`${root.toLowerCase()}\\`)) return value;
  return `%USERPROFILE%${value.slice(root.length)}`;
}

/** A `"` cannot occur in a Windows path, and it is the one character this cannot quote. */
function renderStartupScript(env: AutostartEnv): string {
  for (const value of [env.execPath, env.scriptPath]) {
    if (value.includes('"')) {
      throw new AutostartError(`The tracker path contains a quote character, which no Windows shell can quote safely (${value}).`);
    }
  }
  const node = userProfileRelative(env.execPath, env.home);
  const script = userProfileRelative(env.scriptPath, env.home);
  return [
    `' ${AUTOSTART_MARK}`,
    "' Starts the VibeHub tracker at login with no console window.",
    "' To stop it: run `vibehub-tracker autostart disable`, or just delete this file.",
    "Option Explicit",
    "Dim shell, node, script",
    'Set shell = CreateObject("WScript.Shell")',
    `node = shell.ExpandEnvironmentStrings("${node}")`,
    `script = shell.ExpandEnvironmentStrings("${script}")`,
    // 0 = hidden window, False = do not wait for it. `serve` runs until it is stopped.
    'shell.Run """" & node & """ """ & script & """ serve", 0, False',
    "",
  ].join("\r\n");
}

export interface RenderedAutostart {
  file: string;
  text: string;
  /**
   * UTF-16LE (with a BOM) only when a Windows path outside the home directory still carries
   * non-ASCII after the `%USERPROFILE%` substitution - that is the one case `wscript` cannot
   * read in the ANSI code page. Everything else stays plain UTF-8/ASCII and inspectable.
   */
  encoding: "utf8" | "utf16le";
}

export function renderAutostart(env: AutostartEnv): RenderedAutostart | null {
  const file = autostartFile(env);
  if (file === null) return null;
  switch (env.platform) {
    case "darwin":
      return { file, text: renderLaunchAgent(env), encoding: "utf8" };
    case "linux":
      return { file, text: renderDesktopEntry(env), encoding: "utf8" };
    default: {
      const text = renderStartupScript(env);
      // eslint-disable-next-line no-control-regex
      return { file, text, encoding: /[^\x00-\x7F]/.test(text) ? "utf16le" : "utf8" };
    }
  }
}

function encodeAutostart(rendered: RenderedAutostart): Buffer {
  if (rendered.encoding === "utf8") return Buffer.from(rendered.text, "utf8");
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(rendered.text, "utf16le")]);
}

/** Decodes whichever of the two forms above is on disk. */
function decodeAutostart(raw: Buffer): string {
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) return raw.subarray(2).toString("utf16le");
  return raw.toString("utf8");
}

// ---------------------------------------------------------------------------
// Reading what is already there, and deciding whose it is.
// ---------------------------------------------------------------------------

/** Who wrote the file currently at the artifact path. */
export type AutostartOwner = "none" | "ours" | "other-install" | "foreign";

/**
 * Bounded, symlink-refusing read of the artifact, exactly as `hooks/install.ts` reads a
 * vendor's file: a registration we would follow through a symlink is a registration that
 * can be pointed anywhere.
 */
function readArtifact(file: string): string | null {
  let fd: number | undefined;
  try {
    const stats = fs.lstatSync(file);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
      throw new AutostartError(`${file} is not a regular file. Move it aside and retry.`);
    }
    if (stats.size > MAX_AUTOSTART_BYTES) {
      throw new AutostartError(`${file} is unexpectedly large (${stats.size} bytes); refusing to rewrite it.`);
    }
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    return decodeAutostart(fs.readFileSync(fd));
  } catch (error) {
    if (error instanceof AutostartError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new AutostartError(`${file} could not be read (${(error as NodeJS.ErrnoException).code ?? "unknown error"}).`);
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already gone */ } }
  }
}

function namesThisInstall(body: string, env: AutostartEnv): boolean {
  if (env.platform === "win32") {
    // Windows compares case-blind, and the file may spell the path either absolutely or as
    // `%USERPROFILE%\...` - both mean this install.
    const home = env.home.replace(/[\\/]+$/, "");
    return body.replace(/%USERPROFILE%/gi, home).toLowerCase().includes(env.scriptPath.toLowerCase());
  }
  if (env.platform === "linux") {
    // A Desktop Entry escapes backslashes and `$` inside `Exec`, so the raw path is not
    // literally in the file. Undo the escaping before looking for ourselves in it.
    return body.includes(env.scriptPath) || body.replace(/\\(.)/g, "$1").includes(env.scriptPath);
  }
  return body.includes(env.scriptPath);
}

export function classifyOwner(body: string, env: AutostartEnv): AutostartOwner {
  if (namesThisInstall(body, env)) return "ours";
  if (env.platform === "darwin") {
    // The path is `com.vibehub.tracker.plist`: that label is this product's own namespace,
    // so a plist sitting there which does not name this install belongs to another VibeHub
    // install - the Mac app's, most likely, which writes this very label from Swift.
    return /vibehub/i.test(body) ? "other-install" : "foreign";
  }
  return body.includes(AUTOSTART_MARK) ? "other-install" : "foreign";
}

/**
 * The Mac app's own plist: `LaunchAgent.swift` writes our keys through PropertyListSerialization
 * - sorted, tab-indented, and without our marker, since a serializer cannot write comments -
 * pointing at the tracker inside its bundle. Never byte-equal to our template, so it must never
 * be judged by a byte compare. A marker-less plist outside an app bundle is not the app's: that
 * is a registration from an older installer, and "older install" is the right thing to call it.
 */
function writtenByMacApp(body: string, env: AutostartEnv): boolean {
  return env.platform === "darwin" && !body.includes(AUTOSTART_MARK) && /\.app[\\/]Contents[\\/]/i.test(body);
}

// ---------------------------------------------------------------------------
// Plan / apply, so `--dry-run` shows the exact bytes and writes nothing.
// ---------------------------------------------------------------------------

export interface AutostartPlan {
  mode: "enable" | "disable";
  env: AutostartEnv;
  supported: boolean;
  file: string | null;
  /** Exact bytes that would be written, or null when the file would be removed or absent. */
  content: string | null;
  encoding: "utf8" | "utf16le";
  existed: boolean;
  owner: AutostartOwner;
  changed: boolean;
  /** Set when this plan refuses to act, with the sentence explaining why. Never partial. */
  blocked: string | null;
}

/**
 * Which other install an artifact names, for a refusal that says so instead of leaving the
 * user to open the file themselves. Best-effort and display-only.
 */
function describeInstall(body: string): string {
  const line = body.split(/\r?\n/).find((entry) => /vibehub-tracker\.cjs|index\.js/.test(entry));
  if (line === undefined) return "path unknown";
  return line.replace(/<\/?string>/g, "").replace(/^\s*Exec=/, "").trim().slice(0, 160);
}

function planFor(mode: "enable" | "disable", env: AutostartEnv): AutostartPlan {
  const base = { mode, env, file: null, content: null, encoding: "utf8" as const, existed: false,
    owner: "none" as AutostartOwner, changed: false };
  const rendered = renderAutostart(env);
  if (rendered === null) {
    return { ...base, supported: false,
      blocked: `VibeHub has no autostart mechanism for ${env.platform}. Start the tracker yourself after a reboot.` };
  }
  const current = readArtifact(rendered.file);
  const existed = current !== null;
  const owner = existed ? classifyOwner(current, env) : "none";

  const refuse = (blocked: string): AutostartPlan =>
    ({ ...base, supported: true, file: rendered.file, existed, owner, blocked });

  if (owner === "foreign") {
    return refuse(`${rendered.file} was not written by VibeHub. Leaving it alone - move it aside if you want autostart here.`);
  }
  if (owner === "other-install") {
    const body = current ?? "";
    // macOS only: the Mac app writes this exact label from Swift, pointing into its own
    // bundle, and drives it from its own "Track at login" switch. Rewriting that plist
    // would leave the app's UI describing a job it no longer owns, so it is never ours -
    // not to refresh, and not to remove. Recognised by the bundle path, or by the absence
    // of our marker, which `PropertyListSerialization` cannot write.
    if (env.platform === "darwin" && (!body.includes(AUTOSTART_MARK) || /\.app[\\/]Contents[\\/]/i.test(body))) {
      return refuse(`${rendered.file} belongs to the VibeHub app. Leaving it alone; turn "Track at login" on or off from there.`);
    }
    // Removing is a different question from refreshing: a login entry pointing at a
    // tracker installed somewhere else is still doing its job, and taking it away on this
    // install's behalf would silently stop theirs.
    if (mode === "disable") {
      return refuse(`${rendered.file} points at a VibeHub tracker installed elsewhere (${describeInstall(body)}). Leaving it alone; disable it from that install.`);
    }
    // Enabling falls through on purpose. There is one login entry per user and this is its
    // documented path, so the tracker the user most recently started is the one it should
    // name - the same rule `hooks install` applies when a tracker moves.
  }

  if (mode === "disable") {
    return { ...base, supported: true, file: rendered.file, existed, owner, changed: existed, blocked: null };
  }
  // The app's plist naming this very install - the CLI running from inside the app bundle,
  // through its `vibehub-tracker` shim. Same job, serialized by Swift: rewriting it would buy
  // nothing, bounce the running tracker, and take the job away from "Track at login".
  const appManaged = owner === "ours" && current !== null && writtenByMacApp(current, env);
  return { ...base, supported: true, file: rendered.file, content: rendered.text, encoding: rendered.encoding,
    existed, owner, changed: !appManaged && current !== rendered.text, blocked: null };
}

export function planAutostartEnable(env: AutostartEnv): AutostartPlan { return planFor("enable", env); }
export function planAutostartDisable(env: AutostartEnv): AutostartPlan { return planFor("disable", env); }

/**
 * Atomic where the platform allows it, the same compromise `hooks/install.ts` documents:
 * Windows refuses the rename with EPERM/EBUSY whenever anything holds the destination open
 * (an editor, a scanner, the search indexer), which is common enough on a real desktop that
 * failing over it would be worse than losing atomicity.
 */
function replaceFile(target: string, contents: Buffer): void {
  const temporary = path.join(path.dirname(target), `.vibehub-autostart.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, contents, { mode: 0o600, flag: "wx" });
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw error;
      fs.writeFileSync(target, contents, { mode: 0o600 });
    }
  } finally { try { fs.unlinkSync(temporary); } catch { /* already renamed away */ } }
}

/** One external command. Injected so the tests can assert the argv without running it. */
export interface AutostartRunner {
  (file: string, args: string[]): { ok: boolean; detail: string };
}

const runLaunchctl: AutostartRunner = (file, args) => {
  const result = spawnSync(file, args, { encoding: "utf8", timeout: 20000, windowsHide: true });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0, detail: output || result.error?.message || "" };
};

/**
 * `not-needed` - the file IS the registration (Linux, Windows); it takes effect next login.
 * `loaded`     - launchd accepted the job.
 * `failed`     - launchd refused it; on enable the plist is rolled back, so the state on
 *                disk never claims an autostart that does not exist.
 */
export type AutostartActivation = "not-needed" | "loaded" | "failed";

export interface AutostartApplyResult {
  plan: AutostartPlan;
  wrote: boolean;
  removed: boolean;
  activation: AutostartActivation;
  detail: string | null;
}

/**
 * Writes (or removes) the artifact, then registers it with launchd on macOS.
 *
 * `activate` forces the job to start right now (`launchctl kickstart -k`), which is what an
 * explicit `autostart enable` wants. `start` passes false: it has just started the daemon
 * itself, and `RunAtLoad` covers every login after this one.
 */
export function applyAutostartPlan(
  plan: AutostartPlan,
  options: { runner?: AutostartRunner; activate?: boolean } = {},
): AutostartApplyResult {
  const runner = options.runner ?? runLaunchctl;
  const result: AutostartApplyResult = { plan, wrote: false, removed: false, activation: "not-needed", detail: null };
  if (plan.blocked !== null || !plan.supported || plan.file === null) return result;

  const darwin = plan.env.platform === "darwin";
  const domain = `gui/${process.getuid?.() ?? 0}`;

  if (plan.mode === "disable") {
    // Best-effort, in this order: a job still loaded after its plist is gone would keep
    // running (and keep being restarted) until the next login.
    if (darwin && plan.existed) runner("/bin/launchctl", ["bootout", `${domain}/${LAUNCH_AGENT_LABEL}`]);
    if (plan.existed) {
      try { fs.unlinkSync(plan.file); result.removed = true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new AutostartError(`${plan.file} could not be removed (${(error as NodeJS.ErrnoException).code ?? "unknown error"}).`);
        }
      }
    }
    return result;
  }

  if (plan.changed) {
    fs.mkdirSync(path.dirname(plan.file), { recursive: true });
    replaceFile(plan.file, encodeAutostart({ file: plan.file, text: plan.content ?? "", encoding: plan.encoding }));
    result.wrote = true;
  }
  if (!darwin) return result;

  // A stale registration from a previous install path must not linger and race the new one;
  // nothing to boot out is not an error, which is why this one is not checked.
  runner("/bin/launchctl", ["bootout", `${domain}/${LAUNCH_AGENT_LABEL}`]);
  const bootstrap = runner("/bin/launchctl", ["bootstrap", domain, plan.file]);
  if (!bootstrap.ok) {
    // A plist on disk that launchd never accepted would make `status` claim an autostart
    // this machine does not have. Take it back out.
    if (result.wrote) { try { fs.unlinkSync(plan.file); } catch { /* nothing to undo */ } }
    return { ...result, wrote: false, activation: "failed", detail: bootstrap.detail || "launchctl bootstrap failed" };
  }
  if (options.activate) runner("/bin/launchctl", ["kickstart", "-k", `${domain}/${LAUNCH_AGENT_LABEL}`]);
  return { ...result, activation: "loaded" };
}

// ---------------------------------------------------------------------------
// What the CLI asks.
// ---------------------------------------------------------------------------

export interface AutostartState {
  supported: boolean;
  platform: NodeJS.Platform;
  file: string | null;
  exists: boolean;
  owner: AutostartOwner;
  /**
   * Nothing to refresh: the artifact is exactly what this install would write right now, or
   * it is the Mac app's own plist running this install's entry point (`managedByApp`).
   */
  current: boolean;
  /** Written by the Mac app (LaunchAgent.swift), which keeps it up to date itself. */
  managedByApp: boolean;
  /** The user ran `autostart disable`: `start` must not put it back. */
  optedOut: boolean;
  command: string;
  /** Set when the artifact could not even be read (odd file type, unreadable). */
  problem: string | null;
}

export function autostartStatus(env: AutostartEnv, optedOut: boolean): AutostartState {
  const base = { supported: autostartSupported(env), platform: env.platform, file: autostartFile(env),
    exists: false, owner: "none" as AutostartOwner, current: false, managedByApp: false, optedOut,
    command: autostartCommand(env), problem: null };
  const rendered = (() => { try { return renderAutostart(env); } catch { return null; } })();
  if (rendered === null) return base;
  try {
    const body = readArtifact(rendered.file);
    if (body === null) return base;
    const owner = classifyOwner(body, env);
    const managedByApp = writtenByMacApp(body, env);
    // A byte compare called the app's plist "an older install" and sent the user to
    // `autostart enable`, which then rewrote it. The app refreshes its plist on upgrade.
    const current = owner === "ours" && managedByApp ? true : body === rendered.text;
    return { ...base, exists: true, owner, managedByApp, current };
  } catch (error) {
    return { ...base, exists: true, problem: error instanceof Error ? error.message : "unreadable" };
  }
}

export type AutostartOutcome =
  | "registered"    // written (and loaded, on macOS) just now
  | "already"       // exactly this registration was already in place
  | "opted-out"     // the user disabled it; `start` leaves it disabled
  | "unsupported"   // no mechanism on this platform
  | "blocked"       // somebody else's file is at that path
  | "failed";       // we tried and the OS refused

export interface AutostartReport {
  outcome: AutostartOutcome;
  file: string | null;
  detail: string | null;
}

/**
 * What `start` calls. Autostart is a convenience, not a precondition: every failure here is
 * reported in one line and none of them fails the command the user actually ran.
 *
 * Note the deliberate no-op when the registration is already exactly right - on macOS that
 * skips a `bootout`/`bootstrap` pair, which would otherwise stop and relaunch the daemon on
 * every single `start`.
 */
export function ensureAutostart(
  env: AutostartEnv,
  optedOut: boolean,
  options: { runner?: AutostartRunner } = {},
): AutostartReport {
  if (optedOut) return { outcome: "opted-out", file: autostartFile(env), detail: null };
  let plan: AutostartPlan;
  try {
    plan = planAutostartEnable(env);
  } catch (error) {
    return { outcome: "failed", file: autostartFile(env), detail: error instanceof Error ? error.message : "could not be registered" };
  }
  if (!plan.supported) return { outcome: "unsupported", file: null, detail: plan.blocked };
  if (plan.blocked !== null) return { outcome: "blocked", file: plan.file, detail: plan.blocked };
  if (!plan.changed) return { outcome: "already", file: plan.file, detail: null };
  try {
    const applied = applyAutostartPlan(plan, { runner: options.runner, activate: false });
    if (applied.activation === "failed") return { outcome: "failed", file: plan.file, detail: applied.detail };
    return { outcome: "registered", file: plan.file, detail: null };
  } catch (error) {
    return { outcome: "failed", file: plan.file, detail: error instanceof Error ? error.message : "could not be registered" };
  }
}

/**
 * Deregistration for `logout` and `uninstall`, which must not leave a login item behind that
 * can no longer work. It is not merely untidy: `serve` with no config.json exits, and under
 * launchd's `KeepAlive` a machine would go on waking a credential-less daemon indefinitely.
 * Silent and best-effort - a failure here must never stop a user from logging out.
 */
export function removeAutostartQuietly(env: AutostartEnv, options: { runner?: AutostartRunner } = {}): string | null {
  try {
    const plan = planAutostartDisable(env);
    if (plan.blocked !== null || !plan.changed) return null;
    const applied = applyAutostartPlan(plan, { runner: options.runner });
    return applied.removed ? plan.file : null;
  } catch { return null; }
}
