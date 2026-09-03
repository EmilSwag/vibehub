#!/usr/bin/env node
import { Command } from "commander";
import * as path from "node:path";

// Wire format for heartbeats: ../docs/ARCHITECTURE.md §4.3.
// Local file contract with vibehub/macos: ../docs/ARCHITECTURE.md §4.4.
//
// Privacy invariant (do not break): only projectAlias, tool, model, token counts, and
// timestamps ever leave this process — never a file path, file content, diff, or
// prompt. See ../docs/ARCHITECTURE.md §3.

import { DEFAULT_API_URL, deleteConfig, readConfig, requireConfig, writeConfig } from "./config";
import { daemonStatus, runForeground, startDaemon, stopDaemon } from "./daemon";
import { HIDDEN } from "./projectAlias";
import { readStatus, writeOfflineStatus } from "./statusFile";
import type { TrackerConfig } from "./types";

const CONFIG_PATH_LABEL = "~/.vibehub/config.json";
const STATUS_PATH_LABEL = "~/.vibehub/status.json";

const program = new Command();
program.name("vibehub-tracker").description("VibeHub local activity tracker");

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
    const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/v1/tracker/verify`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
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

program
  .command("login <deviceToken>")
  .description(`validate the token with the server, then write ${CONFIG_PATH_LABEL}`)
  .option("--api-url <url>", "VibeHub server URL", DEFAULT_API_URL)
  .action(async (deviceToken: string, options: { apiUrl: string }) => {
    const verified = await verifyToken(options.apiUrl, deviceToken);
    if (verified.rejected) {
      console.error(`Login failed: token rejected by the server (${verified.detail}).`);
      console.error("Create a new token in VibeHub → Settings → Tracker and try again.");
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
    };
    writeConfig(config);

    if (verified.ok) {
      console.log(`Logged in as ${verified.detail}. Wrote ${CONFIG_PATH_LABEL} (apiUrl: ${config.apiUrl}).`);
    } else {
      console.log(`Wrote ${CONFIG_PATH_LABEL} (apiUrl: ${config.apiUrl}).`);
      console.log(`Could not verify with the server right now (${verified.detail}) — saved anyway.`);
      console.log("Run `vibehub-tracker status` after `start` to confirm it's actually connected.");
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
  .description("poll for active coding-tool processes and send heartbeats")
  .action(() => {
    requireConfig();
    startDaemon(path.resolve(__filename));
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
    if (status.status !== "offline") {
      console.log(`Project: ${status.projectAlias}`);
      console.log(`Tool:    ${status.tool}`);
      console.log(`Model:   ${status.model}`);
      console.log(`Started: ${status.sessionStartedAt}`);
    }
    console.log(`Updated: ${status.updatedAt}`);

    // Round 5: a rejected or never-yet-successful token used to fail completely
    // silently — the daemon "ran," the card just never flipped, with nothing
    // anywhere saying why. `authRejected` is set/cleared on every send attempt
    // (heartbeat.ts); a literal "Connected:" line also gives the connect-prompt
    // an AI agent pastes something unambiguous to check for.
    if (status.authRejected) {
      console.log("Connected: no — token rejected by the server.");
      console.log("  Create a new token in VibeHub → Settings → Tracker, then run:");
      console.log("  vibehub-tracker login <newToken>");
    } else if (!running) {
      console.log("Connected: no — daemon isn't running. Run `vibehub-tracker start`.");
    } else if (status.authRejected === false) {
      console.log("Connected: yes");
    } else {
      console.log("Connected: not yet — waiting for the first heartbeat. Open an AI tool session and check again in ~30s.");
    }
  });

program
  .command("stop")
  .description("stop the running tracker daemon")
  .action(() => {
    stopDaemon();
  });

program
  .command("logout")
  .description(`stop the daemon and remove ${CONFIG_PATH_LABEL}`)
  .action(() => {
    stopDaemon();
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

program.parse();
