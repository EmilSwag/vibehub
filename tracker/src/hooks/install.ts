import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_ATTESTED_FILE_BYTES } from "../adapters/attested";
import { attestedToolsFor, writeConfig } from "../config";
import { ATTESTED_PATH } from "../paths";
import { objectRecord } from "../privacy";
import type { TrackerConfig } from "../types";
import { hookEventsFor, HOOKABLE_TOOLS, isHookableTool } from "./payload";
import type { HookableTool } from "./payload";

/**
 * Installing the producer into a vendor's own hook configuration — the one place this
 * project writes a file it does not own, and only when the user asks for it by name.
 *
 * Nothing here is automatic. There is no discovery pass that notices Cursor is installed,
 * no background repair, and no write during `login`, `start` or an upgrade. Collection for
 * a hookable tool needs two separate acts by the user: this command, and leaving the
 * consent entry it writes in place.
 *
 * The vendor file is treated as someone else's document:
 *   - its unknown keys, unknown events and other people's hook entries are preserved;
 *   - a shape we do not recognise aborts the whole operation rather than being rewritten;
 *   - the first modification leaves a `.vibehub-backup` copy beside it;
 *   - `--dry-run` renders the exact bytes and writes nothing at all.
 *
 * Documented locations and formats (see ../../../docs/ARCHITECTURE.md §4.7 for citations):
 *   Cursor    `~/.cursor/hooks.json`            `{"version":1,"hooks":{"<event>":[{"command":…}]}}`
 *   Windsurf  `~/.codeium/windsurf/hooks.json`  `{"hooks":{"<event>":[{"command":…,"show_output":false}]}}`
 * Project- and system-scope files exist for both vendors and are deliberately never
 * touched: one is shared with a repository's collaborators, the other with every account
 * on the machine, and neither is this user's to opt in on behalf of.
 */

export class HookInstallError extends Error {}

const MAX_HOOK_FILE_BYTES = 256 * 1024;

interface VendorFile {
  /** Relative to the home directory — user scope only, never project or system scope. */
  readonly relativePath: readonly string[];
  /** Extra top-level keys the vendor's schema requires on a file we create. */
  readonly required: Readonly<Record<string, unknown>>;
  /** Extra keys on our own hook entry. */
  readonly entry: Readonly<Record<string, unknown>>;
  /**
   * Which interpreter runs a stored command ON WINDOWS. Measured against both vendors'
   * documentation and then executed: Cascade states that on Windows a hook runs through
   * `powershell -Command`, and that `command` falls back to the same interpreter, where a
   * quoted path on its own is a string literal rather than an invocation - so it needs the
   * call operator. Cursor documents only "shell", and its runner behaves like every
   * Electron app's (`cmd /d /s /c "<line>"`), where the quoted-path form is right.
   */
  readonly windowsShell: "cmd" | "powershell";
}

const VENDOR_FILES: Readonly<Record<HookableTool, VendorFile>> = {
  cursor: {
    relativePath: [".cursor", "hooks.json"],
    required: { version: 1 },
    entry: {},
    windowsShell: "cmd",
  },
  windsurf: {
    relativePath: [".codeium", "windsurf", "hooks.json"],
    required: {},
    // Cascade shows hook output in the UI unless told otherwise; a metadata writer that
    // says nothing should also show nothing.
    entry: { show_output: false },
    windowsShell: "powershell",
  },
};

/**
 * Every entry point below goes through this. The CLI already checks `isHookableTool`, but
 * a guard at the API boundary is what makes "an unlisted tool is inert" provable rather
 * than a property of one call site: no path is computed, no file is read and no consent is
 * written for an id this product does not hook.
 */
function vendorFor(tool: unknown): VendorFile {
  if (!isHookableTool(tool)) {
    throw new HookInstallError(`"${String(tool)}" has no VibeHub hook. Supported: ${HOOKABLE_TOOLS.join(", ")}.`);
  }
  return VENDOR_FILES[tool];
}

export function hookFileFor(tool: HookableTool): string {
  return path.join(os.homedir(), ...vendorFor(tool).relativePath);
}

export function backupPathFor(tool: HookableTool): string {
  return `${hookFileFor(tool)}.vibehub-backup`;
}

/** Shell-quote only what needs it, so the common no-spaces case stays readable. */
const quote = (value: string): string => /^[A-Za-z0-9_./\\:-]+$/.test(value) ? value : `"${value}"`;

/**
 * The command a vendor will spawn. Absolute paths on both sides: an IDE runs hooks from
 * its own working directory (`~/.cursor/`, the workspace root), so nothing relative would
 * resolve, and `PATH` may not carry the tracker at all.
 *
 * Windows takes the launcher instead of `node + .cjs`. A vendor runs a hook command
 * through `cmd.exe`, and cmd's quoting rule ("if the line starts with a quote, strip the
 * first and last one") mangles TWO quoted paths in a row - `"C:\…\node.exe" "C:\…\x.cjs"`
 * can end up as one broken token. One quoted path plus plain arguments is unambiguous, so
 * the `.cmd` launcher is what gets registered and it resolves node and the bundle itself.
 */
export function windowsLauncher(): string {
  return path.join(launcherDir(), "vibehub-tracker.cmd");
}

export function hookCommandFor(tool: HookableTool, execPath: string, scriptPath: string): string {
  const vendor = vendorFor(tool);
  if (process.platform === "win32") {
    const launcher = windowsLauncher();
    // `& '...'` for a PowerShell runner, a quoted token for a cmd one. Both were executed
    // against the real launcher before this was written; see the report's runner matrix.
    return vendor.windowsShell === "powershell"
      ? `& '${launcher.replace(/'/g, "''")}' hook ${tool}`
      : `${quote(launcher)} hook ${tool}`;
  }
  return `${quote(execPath)} ${quote(scriptPath)} hook ${tool}`;
}

/**
 * Windows only: refuse to register a hook that cannot possibly fire.
 *
 * The launcher is written by the Windows connector, not by this command, so `hooks install`
 * can be run on a machine where it does not exist - and a hook pointing at a missing file
 * fails silently in every runner, which is the worst outcome. A `%` in the path is refused
 * for the same reason: cmd would expand it before the launcher ever ran.
 */
function assertLauncherUsable(): void {
  if (process.platform !== "win32") return;
  const launcher = windowsLauncher();
  if (/[%"]/.test(launcher)) {
    throw new HookInstallError(
      `The command path contains a character no shell can quote safely (${launcher}). ` +
      "Move VibeHub to a path without % or \" characters, then retry.");
  }
  if (!fs.existsSync(launcher)) {
    throw new HookInstallError(
      `The vibehub-tracker command is not installed yet (${launcher} is missing). ` +
      "Run the VibeHub connector for Windows first - it writes that command - then retry.");
  }
}

/**
 * Recognises an entry as ours. The suffix is the contract — it is exactly what
 * `hookCommandFor` ends with — and the `vibehub` requirement keeps a same-suffix command
 * belonging to somebody else out of `uninstall`'s way. `expected` additionally matches
 * this machine's own command verbatim, which covers an install from a path that happens
 * not to spell "vibehub" anywhere.
 */
function isOurCommand(command: unknown, tool: HookableTool, expected?: string): boolean {
  if (typeof command !== "string") return false;
  const trimmed = command.trim();
  if (expected !== undefined && trimmed === expected.trim()) return true;
  return /vibehub/i.test(trimmed) && new RegExp(`(?:^|[\\s"'])hook\\s+${tool}$`).test(trimmed);
}

function readHookFile(file: string): Record<string, unknown> | null {
  let fd: number | undefined;
  try {
    const stats = fs.lstatSync(file);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
      throw new HookInstallError(`${file} is not a regular file. Move it aside and retry.`);
    }
    if (stats.size > MAX_HOOK_FILE_BYTES) {
      throw new HookInstallError(`${file} is unexpectedly large (${stats.size} bytes); refusing to rewrite it.`);
    }
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const raw = fs.readFileSync(fd, "utf8");
    if (raw.trim() === "") return {};
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new HookInstallError(`${file} is not valid JSON. Fix or move it aside, then retry.`); }
    const record = objectRecord(parsed);
    if (!record) throw new HookInstallError(`${file} does not contain a JSON object. Refusing to replace it.`);
    return record;
  } catch (error) {
    if (error instanceof HookInstallError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new HookInstallError(`${file} could not be read (${(error as NodeJS.ErrnoException).code ?? "unknown error"}).`);
  } finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
}

export interface HookFilePlan {
  tool: HookableTool;
  file: string;
  command: string;
  events: string[];
  /** Exact bytes that would be written, or null when the file would be removed entirely. */
  content: string | null;
  /** False when the vendor file already says exactly this. */
  changed: boolean;
  /** True when a hook file existed before this plan touches it. */
  existed: boolean;
  /**
   * Which way this plan goes. `applyHookPlan` needs it to know when we are leaving: an
   * uninstall restores the user's original bytes and takes our backup with it.
   */
  mode: "install" | "uninstall";
}

function renderPlan(
  tool: HookableTool, command: string, mode: "install" | "uninstall"
): HookFilePlan {
  const vendor = vendorFor(tool);
  const file = hookFileFor(tool);
  const events = hookEventsFor(tool);
  const before = readHookFile(file);
  const existed = before !== null;
  const root: Record<string, unknown> = { ...(before ?? {}) };

  if (existed) {
    for (const [key, value] of Object.entries(vendor.required)) {
      if (Object.hasOwn(root, key) && root[key] !== value) {
        throw new HookInstallError(
          `${file} declares ${key}=${JSON.stringify(root[key])}, but this tracker only knows ` +
          `${key}=${JSON.stringify(value)}. Update VibeHub, or add the hook by hand.`);
      }
    }
  }
  if (mode === "install") Object.assign(root, vendor.required);

  const hooksValue = root.hooks === undefined ? {} : objectRecord(root.hooks);
  if (!hooksValue) throw new HookInstallError(`${file} has a "hooks" key that is not an object. Refusing to rewrite it.`);
  const hooks: Record<string, unknown> = { ...hooksValue };

  // Every event key in the file is swept, not just the ones we subscribe to today. That is
  // what upgrades a hook file written by an earlier build: when an event is retired (the
  // Cursor session boundaries were), its VibeHub entry is removed rather than left firing a
  // process per event forever. Ours are then re-added to the subscribed events only.
  for (const event of new Set([...events, ...Object.keys(hooks)])) {
    const current = hooks[event];
    if (current !== undefined && !Array.isArray(current)) {
      // Only OUR events are a rewrite refusal; someone else's odd-shaped entry is theirs
      // to keep, so it is skipped rather than turned into an error about their file.
      if (!events.includes(event)) continue;
      throw new HookInstallError(`${file} has a "hooks.${event}" that is not an array. Refusing to rewrite it.`);
    }
    // Other people's entries are kept, in their original order. Ours are dropped and (on
    // install) re-appended, so running install twice cannot stack duplicates and an
    // upgrade that moves the tracker rewrites the path instead of adding a second hook.
    const kept = ((current ?? []) as unknown[])
      .filter((item) => !isOurCommand(objectRecord(item)?.command, tool, command));
    if (mode === "install" && events.includes(event)) {
      // Cascade documents a `powershell` field that takes precedence on Windows. Setting
      // it as well as `command` removes any doubt about which interpreter is used.
      const extras = process.platform === "win32" && vendor.windowsShell === "powershell"
        ? { ...vendor.entry, powershell: command }
        : vendor.entry;
      kept.push({ command, ...extras });
    }
    if (kept.length) hooks[event] = kept;
    else if (Object.hasOwn(hooks, event)) delete hooks[event];
  }

  if (Object.keys(hooks).length) root.hooks = hooks;
  else delete root.hooks;

  // An uninstall that empties a file we created leaves nothing behind, rather than a
  // husk the user has to wonder about. A file with anything else in it stays.
  const ours = mode === "uninstall" && Object.keys(root).every((key) => Object.hasOwn(vendor.required, key));
  const content = ours ? null : `${JSON.stringify(root, null, 2)}\n`;
  const previous = existed ? `${JSON.stringify(before, null, 2)}\n` : null;
  return { tool, file, command, events, content, changed: content !== previous, existed, mode };
}

export function planHookInstall(tool: HookableTool, command: string): HookFilePlan {
  assertLauncherUsable();
  return renderPlan(tool, command, "install");
}

export function planHookUninstall(tool: HookableTool, command: string): HookFilePlan {
  return renderPlan(tool, command, "uninstall");
}

/**
 * The bytes we saved before our first edit, or null if there is no usable backup.
 * A backup larger than the bound we accept for a hook file is not ours to restore.
 */
function savedOriginal(backup: string): string | null {
  try {
    const stat = fs.lstatSync(backup);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_HOOK_FILE_BYTES) return null;
    return fs.readFileSync(backup, "utf8");
  } catch { return null; }
}

/** Same JSON, whatever the whitespace. Key order is preserved by both sides, so this is exact. */
function sameDocument(a: string, b: string): boolean {
  try { return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b)); }
  catch { return false; }
}

/** Writes the plan. Atomic rename, and a one-time backup of whatever was there before. */
export function applyHookPlan(plan: HookFilePlan): void {
  const backupFile = backupPathFor(plan.tool);
  // Leaving is leaving. Once our entries are out of the file, a `hooks.json.vibehub-backup`
  // sitting next to it is litter with our name on it — the user asked us to go, and the
  // only copy of their pre-VibeHub file should not be something they have to clean up
  // after us. It goes on every uninstall path, including the one where there was nothing
  // left to change (fix F-D).
  const finish = (): void => {
    if (plan.mode !== "uninstall") return;
    try { fs.unlinkSync(backupFile); }
    catch { /* never existed, or not ours to remove */ }
  };
  if (!plan.changed) { finish(); return; }
  const directory = path.dirname(plan.file);
  fs.mkdirSync(directory, { recursive: true });
  // An uninstall whose result is the same document we first backed up puts the user's
  // ORIGINAL bytes back, not our re-serialisation of them. We were only ever supposed to
  // add one key; handing back a file with our indentation, our spacing and our trailing
  // newline is a diff they never asked for, in a file they may well have in Git.
  if (plan.mode === "uninstall") {
    const original = savedOriginal(backupFile);
    // A backup exists only because the file was already there when we installed, so
    // restoring it is simply leaving the room as we found it. It also overrides the
    // "delete a file that is now empty" rule below: emptiness is judged after our entries
    // are gone, and a `{ "version": 1 }` husk the user wrote themselves is still theirs to
    // keep. Their own later edits are never at risk here - those leave real entries
    // behind, which makes the document differ and takes the ordinary rewrite path.
    if (original !== null && (plan.content === null || sameDocument(original, plan.content))) {
      const restore = path.join(directory, `.hooks.json.${randomUUID()}.tmp`);
      try {
        fs.writeFileSync(restore, original, { mode: 0o600, flag: "wx" });
        fs.renameSync(restore, plan.file);
      } finally { try { fs.unlinkSync(restore); } catch {} }
      finish();
      return;
    }
  }
  // A file being removed outright held nothing but our own configuration - that is the
  // only case `renderPlan` returns null content for - so there is nothing of the user's
  // to preserve, and leaving a `.vibehub-backup` behind after they asked us to remove
  // ourselves would just be litter with our name on it.
  if (plan.existed && plan.content !== null) {
    if (!fs.existsSync(backupFile)) fs.copyFileSync(plan.file, backupFile, fs.constants.COPYFILE_EXCL);
  }
  if (plan.content === null) {
    try { fs.unlinkSync(plan.file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    finish();
    return;
  }
  const temporary = path.join(directory, `.hooks.json.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, plan.content, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, plan.file);
  } finally { try { fs.unlinkSync(temporary); } catch {} }
  finish();
}

/**
 * Consent, written by the same command that writes the hook. The two belong together: a
 * hook with no consent fills an inbox nobody reads, and consent with no hook collects
 * nothing. Other tools already consented to are left exactly as they are.
 */
export function withConsent(config: TrackerConfig, tool: HookableTool, enabled: boolean): TrackerConfig {
  vendorFor(tool);
  const current = attestedToolsFor(config);
  const tools = enabled
    ? (current.includes(tool) ? current : [...current, tool])
    : current.filter((entry) => entry !== tool);
  return { ...config, attestedMetadata: { enabled: tools.length > 0, tools } };
}

export function setConsent(config: TrackerConfig, tool: HookableTool, enabled: boolean): TrackerConfig {
  const next = withConsent(config, tool, enabled);
  writeConfig(next);
  return next;
}

export interface HookStatus {
  tool: HookableTool;
  consented: boolean;
  file: string;
  fileExists: boolean;
  /** Events where our command is currently registered. */
  registered: string[];
  missing: string[];
  /**
   * Events carrying our command that this build no longer subscribes to — a hook file
   * written by an earlier version. They are harmless (the producer refuses an unsubscribed
   * event) but they still spawn a process per event, so `hooks install` sweeps them out.
   */
  stale: string[];
}

/**
 * Read-only report. It looks at the vendor file's structure and at nothing else — no
 * payload, no inbox content, no vendor state beyond which of our events are wired.
 */
export function hookStatus(config: TrackerConfig, execPath: string, scriptPath: string): HookStatus[] {
  const consented = attestedToolsFor(config);
  return HOOKABLE_TOOLS.map((tool) => {
    const file = hookFileFor(tool);
    const command = hookCommandFor(tool, execPath, scriptPath);
    const events = hookEventsFor(tool);
    let root: Record<string, unknown> | null = null;
    try { root = readHookFile(file); } catch { root = null; }
    const hooks = objectRecord(root?.hooks) ?? {};
    const ours = (event: string): boolean => Array.isArray(hooks[event]) &&
      (hooks[event] as unknown[]).some((item) => isOurCommand(objectRecord(item)?.command, tool, command));
    const registered = events.filter(ours);
    return {
      tool, consented: consented.includes(tool), file, fileExists: root !== null,
      registered, missing: events.filter((event) => !registered.includes(event)),
      stale: Object.keys(hooks).filter((event) => !events.includes(event) && ours(event)),
    };
  });
}

/**
 * The marker line every shim an installer writes carries, byte-for-byte the shell
 * `VIBEHUB_SHIM_MARK` in connect.sh / mac.sh / mac/pkg/scripts/postinstall. Changing it
 * on one side orphans every shim written by the other, which is why the installers' own
 * test compares the two.
 */
export const SHIM_MARK = "# vibehub-tracker shim v1 (managed by VibeHub; safe to delete)";

/**
 * Where the `vibehub-tracker` command lives, per platform.
 *
 * Windows gets one place: `%LOCALAPPDATA%\Programs\VibeHub\vibehub-tracker.cmd`, written
 * by `connect.ps1`. Per user, no administrator, no UAC, the same convention as other
 * per-user apps - and because it is a `.cmd`, both `cmd.exe` and PowerShell run it by
 * bare name, and a vendor's hook runner can spawn it as ONE quoted token.
 */
export function launcherDir(): string {
  if (process.platform !== "win32") return path.join(os.homedir(), ".local", "bin");
  const local = process.env.LOCALAPPDATA && path.isAbsolute(process.env.LOCALAPPDATA)
    ? process.env.LOCALAPPDATA
    : path.join(os.homedir(), "AppData", "Local");
  return path.join(local, "Programs", "VibeHub");
}

/** Where an installer may have put the `vibehub-tracker` command. */
export function shimCandidates(): string[] {
  return process.platform === "win32"
    ? [path.join(launcherDir(), "vibehub-tracker.cmd")]
    : [path.join(os.homedir(), ".local", "bin", "vibehub-tracker"), "/usr/local/bin/vibehub-tracker"];
}

export interface ShimRemoval {
  path: string;
  /** removed · absent · foreign (not ours) · other-install · failed */
  outcome: "removed" | "absent" | "foreign" | "other-install" | "failed";
  detail?: string;
}

/**
 * Removes the entry point THIS install owns, and nothing else.
 *
 * The other half of the removal parity the shim itself provides: a deleted app or a
 * deleted `~/.vibehub` makes the shim delete itself on next use, and `uninstall` does the
 * same job deliberately while everything is still healthy, so nothing dangling is left on
 * PATH either way.
 *
 * Three things are never touched: a file without our marker (someone else's command by
 * that name), a symlink, and a shim that points at a DIFFERENT VibeHub install — a Mac
 * app shim is not the terminal connector's to remove, and vice versa.
 */
export function removeOwnedShims(cjsPath: string, candidates = shimCandidates()): ShimRemoval[] {
  return candidates.map((candidate) => {
    let stats: fs.Stats;
    try { stats = fs.lstatSync(candidate); }
    catch { return { path: candidate, outcome: "absent" as const }; }
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_HOOK_FILE_BYTES) {
      return { path: candidate, outcome: "foreign" as const, detail: "not a regular file" };
    }
    let body = "";
    try { body = fs.readFileSync(candidate, "utf8"); }
    catch { return { path: candidate, outcome: "failed" as const, detail: "could not be read" }; }
    if (!body.includes(SHIM_MARK)) return { path: candidate, outcome: "foreign" as const };
    // The Windows launcher writes `%USERPROFILE%\…` rather than the absolute home path,
    // so a home directory with non-ASCII characters survives the console's code page.
    // Both spellings therefore count as "this install", and Windows compares case-blind.
    const home = os.homedir().replace(/[\\/]+$/, "");
    const resolved = process.platform === "win32"
      ? body.replace(/%USERPROFILE%/gi, home).toLowerCase()
      : body;
    const needle = process.platform === "win32" ? cjsPath.toLowerCase() : cjsPath;
    if (!resolved.includes(needle)) return { path: candidate, outcome: "other-install" as const };
    try { fs.unlinkSync(candidate); }
    catch (error) {
      return { path: candidate, outcome: "failed" as const,
        detail: (error as NodeJS.ErrnoException).code === "EACCES" || (error as NodeJS.ErrnoException).code === "EPERM"
          ? `needs elevation: sudo rm -f ${candidate}` : "could not be removed" };
    }
    return { path: candidate, outcome: "removed" as const };
  });
}

/**
 * What `hooks status` can honestly say about the inbox (fix F-F).
 *
 * Before this, the command printed the same four lines whether the user's hook had never
 * fired, had fired and been refused, or was working perfectly — and the hook itself is
 * deliberately mute, because anything it prints lands inside the user's editor. So a
 * stuck user had no way at all to tell "idle" from "broken", which is the only question
 * they actually have.
 *
 * Read-only, bounded, and metadata only: how many records are waiting to be read, and
 * when the last one was written. Nothing from inside a record is returned, so this stays
 * on the right side of the privacy harness — the records hold no prompt or path anyway,
 * but printing them is still not this command's job.
 */
export function inboxPresence(): {
  path: string;
  exists: boolean;
  records: number | null;
  lastWriteMs: number | null;
  oversized: boolean;
} {
  const absent = { path: ATTESTED_PATH, exists: false, records: null, lastWriteMs: null, oversized: false };
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(ATTESTED_PATH);
    if (!stat.isFile() || stat.isSymbolicLink()) return absent;
  } catch { return absent; }
  const present = { path: ATTESTED_PATH, exists: true, lastWriteMs: stat.mtimeMs };
  // A file past the receiver's own bound is not read by the daemon at all, and the user
  // needs to be told that rather than shown a record count from a file nobody consumes.
  if (stat.size > MAX_ATTESTED_FILE_BYTES) return { ...present, records: null, oversized: true };
  let records: number | null = null;
  try {
    const text = fs.readFileSync(ATTESTED_PATH, "utf8");
    records = text.split("\n").filter((line) => line.trim().length > 0).length;
  } catch { records = null; }
  return { ...present, records, oversized: false };
}

export { HOOKABLE_TOOLS, isHookableTool };
