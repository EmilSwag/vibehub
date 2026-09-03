import { CONFIG_PATH, readJson, removeFile, writeJsonAtomic } from "./paths";
import type { TrackerConfig } from "./types";

// Hosted instance. Override per machine with `vibehub-tracker login <token> --api-url <url>`
// or the VIBEHUB_API_URL env var (handy for local server development).
export const DEFAULT_API_URL =
  process.env.VIBEHUB_API_URL ?? "https://server-production-cc06.up.railway.app";
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
export const DEFAULT_IDLE_THRESHOLD_MS = 300000;

export function readConfig(): TrackerConfig | null {
  return readJson<TrackerConfig>(CONFIG_PATH);
}

export function requireConfig(): TrackerConfig {
  const config = readConfig();
  if (!config) {
    console.error(
      "Not logged in. Run `vibehub-tracker login <deviceToken>` first."
    );
    process.exit(1);
  }
  return config;
}

export function writeConfig(config: TrackerConfig): void {
  writeJsonAtomic(CONFIG_PATH, config);
}

export function deleteConfig(): void {
  removeFile(CONFIG_PATH);
}

export function heartbeatIntervalMs(config: TrackerConfig): number {
  return config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
}

export function idleThresholdMs(config: TrackerConfig): number {
  return config.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
}
