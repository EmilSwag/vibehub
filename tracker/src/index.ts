#!/usr/bin/env node
import { Command } from "commander";
import * as os from "node:os";
import * as path from "node:path";

// Wire format for heartbeats: ../docs/ARCHITECTURE.md §4.3.
// Local file contract with vibehub/macos: ../docs/ARCHITECTURE.md §4.4.
//
// Privacy invariant (do not break): only projectAlias, tool, model, token counts, and
// timestamps ever leave this process — never a file path, file content, diff, or
// prompt. The default collector reads only supported Claude Code/Codex log roots.
// Complete JSONL records may transiently contain conversation content; only an
// explicit metadata allowlist survives. No process/window/OS-idle/git discovery.
// Legacy public history is not erased or made trustworthy by this restriction.

import {
  applyAutostartPlan, autostartStatus, ensureAutostart, hostEnv, planAutostartDisable, planAutostartEnable,
  removeAutostartQuietly,
} from "./autostart";
import type { AutostartPlan, AutostartReport } from "./autostart";
import {
  attestedToolsFor, autostartOptedOut, DEFAULT_API_URL, deleteConfig, readConfig, requireConfig,
  setAutostartPreference, writeConfig,
} from "./config";
import { daemonStatus, runForeground, serveForeground, startDaemon, stopDaemon } from "./daemon";
import { ensureInboxExists, runHookEvent } from "./hooks/inbox";
import {
  applyHookPlan, backupPathFor, hookCommandFor, HOOKABLE_TOOLS, hookStatus, inboxPresence,
  isHookableTool, planHookInstall, planHookUninstall, removeOwnedShims, setConsent,
} from "./hooks/install";
import { HIDDEN } from "./projectAlias";
import { MAX_EVENT_AGE_MS, safeApiOrigin, safeDeviceToken } from "./privacy";
import { readStatus, writeOfflineStatus } from "./statusFile";
import { describeSources, toolLabel } from "./toolLabels";
import type { TrackerConfig } from "./types";

const CONFIG_PATH_LABEL = "~/.vibehub/config.json";
const STATUS_PATH_LABEL = "~/.vibehub/status.json";
const ATTESTED_PATH_LABEL = "~/.vibehub/attested.jsonl";

/** The tracker file an OS autostart entry should point at, for this process. */
const entryPath = (): string => path.resolve(__filename);

/**
 * One line, after `start` has done its real work. Autostart is a convenience: nothing
 * reported here changes the exit code, because the tracker the user asked for is running
 * either way - and a line that quietly claims a login item we failed to write would be
 * worse than the failure.
 */
function reportAutostart(report: AutostartReport): void {
  switch (report.outcome) {
    case "registered":
      console.log(`Autostart: on - it will start again at login (${report.file}).`);
      break;
    case "already":
      console.log(`Autostart: on (${report.file}).`);
      break;
    case "opted-out":
      console.log("Autostart: off - you disabled it. Run `vibehub-tracker autostart enable` to turn it back on.");
      break;
    case "unsupported":
      console.log(`Autostart: not available on this platform (${process.platform}) - start the tracker yourself after a reboot.`);
      break;
    case "blocked":
      console.log(`Autostart: left alone. ${report.detail ?? ""}`.trimEnd());
      break;
    default:
      console.log(`Autostart: could not be registered${report.detail ? ` - ${report.detail}` : ""}.`);
      console.log("  The tracker is running; it just will not come back on its own after a reboot.");
      break;
  }
}

/**
 * A source checkout resolves `__filename` to a .ts file, which plain node cannot run - so
 * the login item would be registered and then silently fail at every boot. Same warning
 * `hooks install` prints, for the same reason.
 */
function warnIfSourceCheckout(): void {
  if (!entryPath().endsWith(".ts")) return;
  console.log("Note: this is a source checkout, so the entry point is TypeScript, which node cannot run");
  console.log("on its own. Run `npm run build` and re-run this command for an entry that actually starts.");
}

const program = new Command();
program.name("vibehub-tracker").description("VibeHub AI-session metadata tracker");

/**
 * Round 5: validates the token against the server before trusting it, so a bad
 * paste fails loudly here instead of silently queuing rejected heartbeats
 * forever once `start` runs. A 401 is unambiguous — refuse to save and exit
 * non-zero. Anything else (offline right now, server hiccup) can't tell us the
 * token is actually bad, so we save it anyway and say so; the daemon's own
 * `authRejected` reporting (see `status`) covers that case once it starts.
 */
async function verifyToken(apiUrl: string, deviceToken: string): Promise<{ ok: boolean; rejected: boolean; detail: string }> {
  try {
    const origin = safeApiOrigin(apiUrl);
    if (!origin || !safeDeviceToken(deviceToken)) return { ok: false, rejected: true, detail: "Invalid tracker configuration" };
    // Bounded verification only; redirects must not forward credentials elsewhere.
    const res = await fetch(`${origin}/api/v1/tracker/verify`, {
      redirect: "error",
      headers: { Authorization: `Bearer ${deviceToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { username?: string };
      return { ok: true, rejected: false, detail: body.username ? `@${body.username}` : "" };
    }
    if (res.status === 401) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, rejected: true, detail: body.error ?? "Invalid or revoked tracker token" };
    }
    return { ok: false, rejected: false, detail: `server returned ${res.status}` };
  } catch (err) {
    return { ok: false, rejected: false, detail: err instanceof Error ? err.message : "network error" };
  }
}

/**
 * FC4 (mac app): the token arrives on stdin, never in argv (readable by any local
 * process via `ps`) and never in the environment. One line, trimmed; anything else
 * is a usage error. Nothing read here is ever echoed back.
 */
async function readTokenFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buf.length;
    if (total > 4096) throw new Error("stdin token too long");
    chunks.push(buf);
  }
  const firstLine = Buffer.concat(chunks).toString("utf8").split(/\r?\n/, 1)[0] ?? "";
  return firstLine.trim();
}

program
  .command("login [deviceToken]")
  .description(`validate the token with the server, then write ${CONFIG_PATH_LABEL}`)
  .option("--api-url <url>", "VibeHub server URL", DEFAULT_API_URL)
  .option("--token-stdin", "read the device token from stdin (one line) instead of an argument")
  .action(async (deviceTokenArg: string | undefined, options: { apiUrl: string; tokenStdin?: boolean }) => {
    let deviceToken: string;
    if (options.tokenStdin) {
      if (deviceTokenArg) {
        console.error("Login failed: pass the token either as an argument or on stdin, not both.");
        process.exit(1);
      }
      deviceToken = await readTokenFromStdin().catch((err: unknown) => {
        console.error(`Login failed: ${err instanceof Error ? err.message : "could not read stdin"}.`);
        process.exit(1);
      });
    } else if (deviceTokenArg) {
      deviceToken = deviceTokenArg;
    } else {
      console.error("Login failed: missing device token. Pass it as an argument or use --token-stdin.");
      process.exit(1);
    }
    if (!safeDeviceToken(deviceToken)) {
      console.error("Login failed: the device token is empty or malformed.");
      console.error("Create a new token in VibeHub > Settings > Tracker and try again.");
      process.exit(1);
    }

    const verified = await verifyToken(options.apiUrl, deviceToken);
    if (verified.rejected) {
      console.error(`Login failed: token rejected by the server (${verified.detail}).`);
      console.error("Create a new token in VibeHub > Settings > Tracker and try again.");
      process.exit(1);
    }

    const existing = readConfig();
    const config: TrackerConfig = {
      apiUrl: options.apiUrl,
      deviceToken,
      projectAliases: existing?.projectAliases ?? {},
      heartbeatIntervalMs: existing?.heartbeatIntervalMs,
      idleThresholdMs: existing?.idleThresholdMs,
      toolProcessNames: existing?.toolProcessNames,
      // A device-level consent setting, like projectAliases: re-running `login`
      // must not silently switch the receiver on or off behind the user's back.
      attestedMetadata: existing?.attestedMetadata,
      // Same reasoning: a re-install that re-runs `login` must not undo an explicit
      // `autostart disable` by dropping the field that records it.
      autostart: existing?.autostart,
    };
    writeConfig(config);

    if (verified.ok) {
      console.log(`Logged in as ${verified.detail}. Wrote ${CONFIG_PATH_LABEL} (apiUrl: ${config.apiUrl}).`);
    } else {
      console.log(`Wrote ${CONFIG_PATH_LABEL} (apiUrl: ${config.apiUrl}).`);
      console.log(`Could not verify with the server right now (${verified.detail}) - saved anyway.`);
      console.log("Run `vibehub-tracker status` after `start` to confirm it's actually connected.");
    }

    // Round 10, T2: a daemon that is already running is the case where a fresh
    // token looks like it did nothing. Say what happens next instead of letting
    // the user assume `login` was enough — or that it wasn't.
    const daemon = daemonStatus();
    if (daemon.running) {
      console.log(`Tracker is running (pid ${daemon.pid}): it picks up this token within 30 s.`);
      console.log("Run `start` anyway - it replaces a tracker started from an older build.");
    }
  });

program
  .command("pair")
  .description("pair this device with your VibeHub account via browser approval (zero typing)")
  .option("--api-url <url>", "VibeHub server URL", DEFAULT_API_URL)
  .option("--no-browser", "do not open the browser automatically")
  .action(async (options: { apiUrl: string; browser: boolean }) => {
    const origin = safeApiOrigin(options.apiUrl);
    if (!origin) {
      console.error("Pairing failed: invalid API URL.");
      process.exit(1);
    }
    const osName = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : "linux";
    const hostname = os.hostname();
    console.log("Requesting pairing code from VibeHub...");
    const reqRes = await fetch(`${origin}/api/v1/tracker/pair/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName: hostname, os: osName }),
    });
    if (!reqRes.ok) {
      console.error(`Pairing failed: server returned ${reqRes.status}`);
      process.exit(1);
    }
    const session = (await reqRes.json()) as {
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      expiresIn: number;
      interval: number;
    };
    console.log(`Pairing code: ${session.userCode}`);
    console.log(`Approve in browser: ${session.verificationUri}`);
    if (options.browser) {
      const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      import("node:child_process").then(({ exec }) => {
        exec(`${openCmd} ${JSON.stringify(session.verificationUri)}`);
      });
    }
    console.log("Waiting for approval in browser...");
    const deadline = Date.now() + session.expiresIn * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, Math.max(1, session.interval) * 1000));
      const pollRes = await fetch(`${origin}/api/v1/tracker/pair/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode: session.deviceCode }),
      });
      if (pollRes.ok) {
        const poll = (await pollRes.json()) as { status: string; token?: string; username?: string };
        if (poll.status === "approved" && poll.token) {
          const existing = readConfig();
          const config: TrackerConfig = {
            apiUrl: options.apiUrl,
            deviceToken: poll.token,
            projectAliases: existing?.projectAliases ?? {},
            heartbeatIntervalMs: existing?.heartbeatIntervalMs,
            idleThresholdMs: existing?.idleThresholdMs,
            toolProcessNames: existing?.toolProcessNames,
            attestedMetadata: existing?.attestedMetadata,
            autostart: existing?.autostart,
          };
          writeConfig(config);
          console.log(`Logged in as @${poll.username ?? "user"}. Wrote ${CONFIG_PATH_LABEL}.`);
          console.log("Run `vibehub-tracker start` to start tracking.");
          return;
        } else if (poll.status === "expired") {
          console.error("Pairing code expired. Run `vibehub-tracker pair` again to retry.");
          process.exit(1);
        }
      }
    }
    console.error("Pairing timed out. Run `vibehub-tracker pair` again to retry.");
    process.exit(1);
  });

program
  .command("set <projectFolder> <alias>")
  .description(`remap a project folder's display alias, or hide it with the literal "${HIDDEN}"`)
  .action((projectFolder: string, alias: string) => {
    const config = requireConfig();
    config.projectAliases = { ...config.projectAliases, [projectFolder]: alias };
    writeConfig(config);
    console.log(
      alias === HIDDEN
        ? `"${projectFolder}" will be hidden from presence.`
        : `"${projectFolder}" will be shown as "${alias}".`
    );
  });

program
  .command("start")
  // Names every tool the daemon can actually send, not only the ones it reads logs for -
  // Cursor and Windsurf arrive through the opt-in hook inbox, and a user who ran
  // `hooks install` should see them here rather than wonder whether `start` covers them.
  .description("track Claude Code / Codex / Quadcode AI session metadata, plus Cursor / Windsurf if you opted in with `hooks install`, and send heartbeats")
  .option("--no-autostart", "start the tracker this once without registering it to start at login")
  .action(async (options: { autostart: boolean }) => {
    const config = requireConfig();
    // Autostart is registered AFTER the daemon is up, never before. On macOS the
    // LaunchAgent carries RunAtLoad, so bootstrapping it starts `serve` immediately -
    // doing that first would leave two processes racing for tracker.pid.
    await startDaemon(entryPath());
    if (!options.autostart) {
      console.log("Autostart: not registered (--no-autostart). Run `vibehub-tracker autostart enable` when you want it.");
      return;
    }
    reportAutostart(ensureAutostart(hostEnv(entryPath()), autostartOptedOut(config)));
  });

/**
 * Start at login, and keep starting at login.
 *
 * One user-scope file per platform, in the place that platform documents for it: a launchd
 * LaunchAgent on macOS, an XDG autostart entry on Linux, a Startup-folder script on Windows.
 * No elevation, nothing system-wide, nothing hidden - `status` prints the exact path and
 * `disable` removes it. See src/autostart.ts for why each artifact looks the way it does.
 */
const autostart = program
  .command("autostart")
  .description("start the tracker automatically at login (enable | disable | status)");

/**
 * Planning reads the file that is already there, so it can fail on something the user has
 * to fix (a symlink in place of the registration, a file too large to be ours). That is a
 * refusal, not a crash: one sentence and a non-zero exit, with nothing written.
 */
function planOrExit(mode: "enable" | "disable"): AutostartPlan {
  const env = hostEnv(entryPath());
  try {
    return mode === "enable" ? planAutostartEnable(env) : planAutostartDisable(env);
  } catch (error) {
    console.error(`Autostart could not be ${mode === "enable" ? "enabled" : "disabled"}: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }
}

autostart
  .command("enable")
  .description("register the tracker to start at login, and start it now")
  .option("--dry-run", "print the exact file that would be written, and change nothing")
  .action((options: { dryRun?: boolean }) => {
    const config = requireConfig();
    const env = hostEnv(entryPath());
    const plan = planOrExit("enable");
    if (!plan.supported || plan.blocked !== null) {
      console.error(`Autostart was not enabled. ${plan.blocked ?? "No mechanism on this platform."}`);
      process.exit(1);
    }
    if (options.dryRun) {
      console.log(`Would write ${plan.file}:`);
      console.log(plan.content ?? "");
      console.log(`Would record the preference in ${CONFIG_PATH_LABEL}. Nothing was changed.`);
      return;
    }
    const applied = applyAutostartPlan(plan, { activate: true });
    if (applied.activation === "failed") {
      console.error(`Autostart was not enabled: ${applied.detail ?? "the system refused the registration"}.`);
      console.error("Nothing was left behind. The tracker itself is unaffected.");
      process.exit(1);
    }
    // Written only once the OS has actually accepted it, so the recorded preference can
    // never describe a login item this machine does not have.
    setAutostartPreference(config, true);
    console.log(`Autostart ${applied.wrote ? "enabled" : "already enabled"}: ${plan.file}`);
    console.log(`At login it runs: ${env.execPath} ${env.scriptPath} serve`);
    if (applied.activation === "loaded") {
      console.log("launchd loaded it and will also restart the tracker if it ever crashes.");
    }
    console.log("Turn it off with `vibehub-tracker autostart disable`, or by deleting that file.");
    warnIfSourceCheckout();
  });

autostart
  .command("disable")
  .description("remove the login entry and remember that choice, so `start` does not put it back")
  .option("--dry-run", "print what would change, and change nothing")
  .action((options: { dryRun?: boolean }) => {
    const config = requireConfig();
    const plan = planOrExit("disable");
    if (plan.blocked !== null) {
      console.error(`Autostart was not changed. ${plan.blocked}`);
      process.exit(1);
    }
    if (options.dryRun) {
      console.log(plan.changed ? `Would remove ${plan.file}.` : `Nothing of ours is registered${plan.file ? ` at ${plan.file}` : ""}.`);
      console.log(`Would record the choice in ${CONFIG_PATH_LABEL}, so \`start\` leaves it off. Nothing was changed.`);
      return;
    }
    const applied = applyAutostartPlan(plan);
    // Recorded even when there was no file to remove: the point of this command is that
    // the NEXT `start` respects it, and `start` reads the preference, not the disk.
    setAutostartPreference(config, false);
    console.log(applied.removed ? `Autostart disabled. Removed ${plan.file}.` : "Autostart was not registered.");
    console.log("`start` will leave it off from now on. Re-enable it with `vibehub-tracker autostart enable`.");
    console.log("This does not stop a tracker that is running now - use `vibehub-tracker stop` for that.");
  });

autostart
  .command("status")
  .description("show whether the tracker starts at login, and from which file")
  .action(() => {
    const env = hostEnv(entryPath());
    const state = autostartStatus(env, autostartOptedOut(readConfig()));
    if (!state.supported) {
      console.log(`Autostart: not available on this platform (${state.platform}).`);
      return;
    }
    const on = state.exists && state.owner === "ours" && !state.optedOut;
    console.log(`Autostart: ${on ? "on" : "off"}`);
    console.log(`File:      ${state.file}${state.exists ? "" : " (not present)"}`);
    console.log(`Runs:      ${state.command}`);
    if (state.problem !== null) {
      console.log(`Note:      that file could not be read - ${state.problem}`);
      return;
    }
    if (state.owner === "foreign") {
      console.log("Note:      that file was not written by VibeHub, so it is left alone.");
    } else if (state.owner === "other-install") {
      console.log("Note:      it belongs to another VibeHub install (the Mac app, or a tracker elsewhere).");
      console.log("           Manage autostart from that install; this one will not overwrite it.");
    } else if (state.managedByApp) {
      console.log("Note:      the VibeHub app manages it. Turn \"Track at login\" on or off there.");
    } else if (state.exists && !state.current) {
      console.log("Note:      it points at an older install. Run `vibehub-tracker autostart enable` to refresh it.");
    }
    if (state.optedOut) {
      console.log("Note:      you disabled autostart, so `start` will not register it.");
    } else if (!state.exists) {
      console.log("Note:      `vibehub-tracker start` registers it, or run `autostart enable` on its own.");
    }
  });

program
  .command("status")
  .description(`pretty-print the current ${STATUS_PATH_LABEL}`)
  .action(() => {
    const config = readConfig();
    if (!config) {
      console.log("Not logged in. Run `vibehub-tracker login <deviceToken>` first.");
      return;
    }

    const status = readStatus();
    const { running, pid } = daemonStatus();

    console.log(`Daemon:  ${running ? `running (pid ${pid})` : "not running"}`);
    // One word here, the full picture in `autostart status`. A daemon that is running
    // now and a daemon that comes back after a reboot are different questions, and this
    // is where a user looks for both.
    const login = autostartStatus(hostEnv(entryPath()), autostartOptedOut(config));
    console.log(`At login: ${!login.supported ? `not available on ${login.platform}`
      : login.optedOut ? "no - disabled with `autostart disable`"
      : login.exists && login.owner === "ours" ? "yes"
      : login.exists ? "no - that login entry belongs to another install"
      : "no - run `vibehub-tracker autostart enable`"}`);
    console.log(`Status:  ${status.status}`);
    if (status.status === "active") {
      console.log(`Project: ${status.projectAlias}`);
      console.log(`Tool:    ${status.tool}`);
      console.log(`Model:   ${status.model}`);
      console.log(`Started: ${status.sessionStartedAt}`);
    }
    console.log(`Updated: ${status.updatedAt}`);

    const attested = attestedToolsFor(config);
    console.log("Scope:   supported AI-session activity only (Claude Code, Codex, Quadcode AI)");
    if (attested.length > 0) {
      console.log(`Receiver: on for ${attested.map(toolLabel).join(", ")} (opt-in, ${ATTESTED_PATH_LABEL})`);
      console.log("          Records come from a separate producer you installed; this tracker reads");
      console.log("          no log, process or window for those tools, and never estimates their usage.");
      console.log("          `vibehub-tracker hooks status` shows whether anything is writing them.");
    }
    const seeingCutoff = Date.now() - MAX_EVENT_AGE_MS;
    const seeing = (status.sources ?? []).filter((s) => Date.parse(s.lastSeenAt) >= seeingCutoff);
    if (seeing.length > 0) {
      console.log(`Seeing:  ${describeSources(seeing)}`);
    } else if (running) {
      console.log("Seeing:  no recent supported AI usage records (AI-only idle; other apps are not observed)");
    }

    // Keep the installer-readable line. An accepted connection-v1 transport
    // receipt is independent of login verification and supported AI activity.
    const freshCheck = Date.parse(status.lastConnectionCheckAt ?? "") >= Date.now() - Math.max(90000, 3 * (config.heartbeatIntervalMs ?? 30000));
    if (status.authRejected) {
      console.log("Connected: no - token rejected by the server.");
      console.log("  Create a new token in VibeHub > Settings > Tracker, then run:");
      console.log("  vibehub-tracker login <newToken>");
    } else if (!running) {
      console.log("Connected: no - daemon isn't running. Run `vibehub-tracker start`.");
    } else if (status.connected && freshCheck) {
      console.log("Connected: yes");
      console.log("  Recent server-accepted daemon connection; does not imply an active AI session.");
    } else {
      console.log("Connected: not yet - waiting for a successful daemon connection check; no AI activity is required.");
    }
  });

program
  .command("stop")
  .description("stop the running tracker daemon (waits for it to end the session cleanly)")
  .action(async () => {
    await stopDaemon();
  });

program
  .command("logout")
  .description(`stop the daemon and remove ${CONFIG_PATH_LABEL}`)
  .action(async () => {
    // Stop first: its fallback session_end needs config.json to still exist.
    await stopDaemon();
    // Before the config goes: a login entry left behind would run `serve` at every boot
    // with no credentials for it to use. On macOS that is worse than untidy - launchd's
    // KeepAlive would keep waking a credential-less daemon indefinitely.
    const removed = removeAutostartQuietly(hostEnv(entryPath()));
    if (removed !== null) console.log(`Removed the login entry (${removed}).`);
    deleteConfig();
    writeOfflineStatus();
    console.log(`Logged out. Removed ${CONFIG_PATH_LABEL}.`);
  });

program
  .command("uninstall")
  .description("remove what this install owns: the hooks it wrote, its consent, its config and the `vibehub-tracker` command")
  .action(async () => {
    const config = readConfig();
    const script = path.resolve(__filename);
    await stopDaemon();

    // 0. The login entry, if this install is the one that wrote it. Removing ourselves
    //    has to include the part of us that would otherwise come back after a reboot.
    const loginEntry = removeAutostartQuietly(hostEnv(script));
    if (loginEntry !== null) console.log(`Removed the login entry (${loginEntry}).`);

    // 1. The vendors' hook files: only VibeHub's own entries, never anyone else's.
    if (config) {
      for (const tool of HOOKABLE_TOOLS) {
        try {
          const plan = planHookUninstall(tool, hookCommandFor(tool, process.execPath, script));
          applyHookPlan(plan);
          if (plan.changed) console.log(`Removed the VibeHub hook from ${plan.file}.`);
        } catch (error) {
          console.log(`Left ${toolLabel(tool)}'s hook file alone: ${error instanceof Error ? error.message : "unreadable"}`);
        }
      }
    }

    // 2. The entry point this install put on PATH. A command by that name that is not
    //    ours, or that belongs to another VibeHub install, is deliberately left alone.
    for (const removal of removeOwnedShims(script)) {
      switch (removal.outcome) {
        case "removed": console.log(`Removed ${removal.path}.`); break;
        case "foreign": console.log(`Left ${removal.path} alone - it is not VibeHub's.`); break;
        case "other-install": console.log(`Left ${removal.path} alone - it belongs to another VibeHub install.`); break;
        case "failed": console.log(`Could not remove ${removal.path}${removal.detail ? ` - ${removal.detail}` : ""}.`); break;
        default: break;
      }
    }

    // 3. Account state, exactly as `logout` does it.
    deleteConfig();
    writeOfflineStatus();
    console.log(`Removed ${CONFIG_PATH_LABEL}.`);
    console.log(`Left in place: ${ATTESTED_PATH_LABEL} (written by the hook producer, not by this tracker),`);
    console.log("and the installed files themselves. To finish removing a terminal install:");
    console.log("  rm -rf ~/.vibehub");
    console.log("A Mac app install is removed by dragging VibeHub.app to the Trash.");
  });

program
  .command("run-loop", { hidden: true })
  .description("internal: runs the heartbeat loop in the foreground (spawned by `start`)")
  .action(() => {
    const config = requireConfig();
    runForeground(config);
  });

// Lane B (mac app): what the VibeHub app's LaunchAgent runs (`ProgramArguments: [node,
// vibehub-tracker.cjs, serve]`). Foreground, owns tracker.pid, exits 0 when a healthy
// supervised tracker already runs - see serveForeground in daemon.ts. Hidden because a
// person wants `start`; a supervisor wants this.
program
  .command("serve", { hidden: true })
  .description("internal: foreground daemon for a supervisor (launchd) - owns tracker.pid; exits 0 if a healthy supervised tracker already runs")
  .action(async () => {
    // Not `requireConfig`. This is the entry point a supervisor runs, and a supervisor
    // reads a non-zero exit as a crash: under launchd's `KeepAlive { SuccessfulExit:
    // false }` a logged-out machine would wake a credential-less daemon every 30 s,
    // forever. "Nothing to do" is a clean exit. `logout` and `uninstall` remove the
    // login entry as well, so this is the belt to that braces.
    const config = readConfig();
    if (!config) {
      console.log(`Nothing to serve: no ${CONFIG_PATH_LABEL}. Run \`vibehub-tracker login <deviceToken>\` first.`);
      return;
    }
    await serveForeground(config, path.resolve(__filename));
  });

// Round 5 (Cursor + Windsurf): the PRODUCER side of the opt-in receiver. `hook` is what a
// vendor's own hook system spawns; `hooks` is how a person turns that on and off. Both
// live here, and neither is reachable from the daemon: the collector only ever reads
// ~/.vibehub/attested.jsonl. See ../docs/ARCHITECTURE.md §4.7.
program
  .command("hook <tool>", { hidden: true })
  .description("internal: record one Cursor/Windsurf hook event as AI-session metadata (payload on stdin)")
  .action(async (tool: string) => {
    // Silent and always successful, by design. This runs inside the user's editor: a
    // message would land in the IDE's own output, and a non-zero exit would present as a
    // failed hook - for a metadata write that is allowed to do nothing.
    await runHookEvent(tool, process.stdin).catch(() => false);
    process.exitCode = 0;
  });

const hooks = program
  .command("hooks")
  .description("opt in to Cursor / Windsurf activity by installing VibeHub's hook in their own config");

hooks
  .command("install <tool>")
  .description(`register the hook for ${HOOKABLE_TOOLS.join(" or ")} and consent to its records`)
  .option("--dry-run", "print the exact file that would be written, and change nothing")
  .action((tool: string, options: { dryRun?: boolean }) => {
    const config = requireConfig();
    if (!isHookableTool(tool)) {
      console.error(`Unknown tool "${tool}". Supported: ${HOOKABLE_TOOLS.join(", ")}.`);
      process.exit(1);
    }
    const plan = planHookInstall(tool, hookCommandFor(tool, process.execPath, path.resolve(__filename)));
    if (options.dryRun) {
      console.log(`Would write ${plan.file}:`);
      console.log(plan.content ?? "");
      console.log(`Would consent to "${tool}" records in ${CONFIG_PATH_LABEL}. Nothing was changed.`);
      return;
    }
    applyHookPlan(plan);
    setConsent(config, tool, true);
    // The receiver primes at EOF the first time it sees the inbox, so that a restart can
    // never replay work that was already billed. Creating it empty here - at the moment
    // consent is granted, before any hook can fire - means the daemon's first sight is an
    // empty file and the user's FIRST turn counts. Without it the first record also
    // created the file and was skipped, which looks like flakiness rather than a bug.
    ensureInboxExists();
    console.log(`${toolLabel(tool)} hook ${plan.changed ? "installed" : "already present"}: ${plan.file}`);
    console.log(`Events: ${plan.events.join(", ")}. Restart ${toolLabel(tool)} for it to pick the hook up.`);
    if (plan.existed && plan.changed) console.log(`Previous file kept as ${backupPathFor(tool)}.`);
    console.log(`Consented in ${CONFIG_PATH_LABEL}: the tracker now reads ${ATTESTED_PATH_LABEL} for ${toolLabel(tool)}.`);
    console.log("Each event records six fields: the tool, a random id, the time, the model when the id is one");
    console.log("this tracker knows, and the project folder's name. No prompt, no path, no transcript, and no");
    console.log("token count - neither tool reports one, so their usage stays unknown rather than zero.");
    // A source checkout resolves __filename to a .ts file, which plain node cannot run,
    // so the hook would be registered and silently never produce anything. Say so.
    if (path.resolve(__filename).endsWith(".ts")) {
      console.log("Note: this is a source checkout, so the hook points at a TypeScript entry point that node");
      console.log("cannot run on its own. Run `npm run build` and re-run this command for a hook that fires.");
    }
  });

hooks
  .command("uninstall <tool>")
  .description("remove VibeHub's hook from that tool's config and withdraw consent")
  .option("--dry-run", "print what would change, and change nothing")
  .action((tool: string, options: { dryRun?: boolean }) => {
    const config = requireConfig();
    if (!isHookableTool(tool)) {
      console.error(`Unknown tool "${tool}". Supported: ${HOOKABLE_TOOLS.join(", ")}.`);
      process.exit(1);
    }
    const plan = planHookUninstall(tool, hookCommandFor(tool, process.execPath, path.resolve(__filename)));
    if (options.dryRun) {
      console.log(plan.changed
        ? `Would rewrite ${plan.file}${plan.content === null ? " (removing it - nothing else is in it)" : ""}:`
        : `${plan.file} carries no VibeHub hook; nothing to remove.`);
      if (plan.changed && plan.content !== null) console.log(plan.content);
      console.log(`Would withdraw consent for "${tool}". Nothing was changed.`);
      return;
    }
    applyHookPlan(plan);
    setConsent(config, tool, false);
    console.log(plan.changed
      ? `Removed the VibeHub hook from ${plan.file}.`
      : `No VibeHub hook was registered in ${plan.file}.`);
    console.log(`Withdrew consent for ${toolLabel(tool)}; its records are no longer read.`);
    console.log(`${ATTESTED_PATH_LABEL} is left alone - it belongs to the producer, not to this tracker.`);
  });

hooks
  .command("status")
  .description("show which hooks are installed and consented to")
  .action(() => {
    const config = requireConfig();
    for (const state of hookStatus(config, process.execPath, path.resolve(__filename))) {
      console.log(`${toolLabel(state.tool)}:`);
      console.log(`  Consent: ${state.consented ? "yes" : "no"}`);
      console.log(`  Hook:    ${state.registered.length === 0 ? "not installed"
        : state.missing.length === 0 ? `installed (${state.registered.join(", ")})`
        : `partly installed (${state.registered.join(", ")}; missing ${state.missing.join(", ")})`}`);
      console.log(`  File:    ${state.file}${state.fileExists ? "" : " (absent)"}`);
      if (state.stale.length > 0) {
        console.log(`  Stale:   ${state.stale.join(", ")} - registered by an older VibeHub and no longer used.`);
        console.log(`           Run \`vibehub-tracker hooks install ${state.tool}\` to clear them.`);
      }
      if (state.consented && state.registered.length === 0) {
        console.log(`  Note:    consented, but nothing writes records - run \`vibehub-tracker hooks install ${state.tool}\`.`);
      }
      if (!state.consented && state.registered.length > 0) {
        console.log("  Note:    the hook is installed but its records are ignored until you consent again.");
      }
    }
    const inbox = inboxPresence();
    console.log(`Inbox:     ${inbox.path}${inbox.exists ? "" : " (not created yet)"}`);
    // The hook process is deliberately silent - anything it printed would land inside the
    // user's editor - so this is the one place that can distinguish "nothing has happened
    // yet" from "something is wrong" (fix F-F).
    if (inbox.exists) {
      const written = inbox.lastWriteMs === null ? null : new Date(inbox.lastWriteMs);
      if (inbox.oversized) {
        console.log("           Too large for the tracker to read. Stop the tracker, delete this file, start it again.");
      } else if ((inbox.records ?? 0) === 0) {
        console.log("           No events yet. Make one request in the tool, then run this command again.");
        console.log("           If it stays empty: restart the tool so it re-reads its hook file.");
      } else {
        console.log(`           ${inbox.records} event${inbox.records === 1 ? "" : "s"} written${written ? `, last at ${written.toLocaleString()}` : ""}.`);
        console.log("           The hook is working. The file is a log, not a queue - it keeps every");
        console.log("           record, and only a running tracker turns new ones into activity, so if");
        console.log("           nothing reaches your profile check `vibehub-tracker status` next.");
      }
    } else {
      console.log("           No hook has fired yet: the file is created the first time one does.");
    }
    console.log("           Written only by the hook command; the tracker never writes it.");
    console.log("Tokens:    not reported by either tool, so usage stays unknown - never 0, never estimated.");
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
