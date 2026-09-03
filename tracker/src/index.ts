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

program
  .command("login <deviceToken>")
  .description(`write ${CONFIG_PATH_LABEL} with the given device token`)
  .option("--api-url <url>", "VibeHub server URL", DEFAULT_API_URL)
  .action((deviceToken: string, options: { apiUrl: string }) => {
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
    console.log(`Logged in. Wrote ${CONFIG_PATH_LABEL} (apiUrl: ${config.apiUrl}).`);
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
