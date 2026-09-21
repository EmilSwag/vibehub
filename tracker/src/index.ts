#!/usr/bin/env node
import { Command } from "commander";
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

import { attestedToolsFor, DEFAULT_API_URL, deleteConfig, readConfig, requireConfig, writeConfig } from "./config";
import { daemonStatus, runForeground, serveForeground, startDaemon, stopDaemon } from "./daemon";
import { HIDDEN } from "./projectAlias";
import { MAX_EVENT_AGE_MS, safeApiOrigin, safeDeviceToken } from "./privacy";
import { readStatus, writeOfflineStatus } from "./statusFile";
import { describeSources, toolLabel } from "./toolLabels";
import type { TrackerConfig } from "./types";

const CONFIG_PATH_LABEL = "~/.vibehub/config.json";
const STATUS_PATH_LABEL = "~/.vibehub/status.json";

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
  .description("track supported Claude Code / Codex session-log metadata and send heartbeats")
  .action(async () => {
    requireConfig();
    await startDaemon(path.resolve(__filename));
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
    console.log(`Status:  ${status.status}`);
    if (status.status === "active") {
      console.log(`Project: ${status.projectAlias}`);
      console.log(`Tool:    ${status.tool}`);
      console.log(`Model:   ${status.model}`);
      console.log(`Started: ${status.sessionStartedAt}`);
    }
    console.log(`Updated: ${status.updatedAt}`);

    const attested = attestedToolsFor(config);
    console.log("Scope:   supported AI-session activity only (Claude Code, Codex)");
    if (attested.length > 0) {
      console.log(`Receiver: on for ${attested.map(toolLabel).join(", ")} (opt-in, ~/.vibehub/attested.jsonl)`);
      console.log("          Records come from a separate producer you installed; this tracker reads");
      console.log("          no log, process or window for those tools, and never estimates their usage.");
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
    deleteConfig();
    writeOfflineStatus();
    console.log(`Logged out. Removed ${CONFIG_PATH_LABEL}.`);
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
    const config = requireConfig();
    await serveForeground(config, path.resolve(__filename));
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
