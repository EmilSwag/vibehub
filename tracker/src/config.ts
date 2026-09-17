import { createHash } from "node:crypto";
import { CONFIG_PATH, readJson, removeFile, writeJsonAtomic } from "./paths";
import { MAX_EVENT_AGE_MS, objectRecord, safeAlias, safeApiOrigin, safeDeviceToken } from "./privacy";
import type { TrackerConfig } from "./types";

export const DEFAULT_API_URL = process.env.VIBEHUB_API_URL ?? "https://server-production-cc06.up.railway.app";
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
export const DEFAULT_IDLE_THRESHOLD_MS = MAX_EVENT_AGE_MS;

/** Explicit local config fields only; obsolete process-name options have no effect. */
export function projectConfig(value: unknown): TrackerConfig | null {
  const c = objectRecord(value);
  const apiUrl = safeApiOrigin(c?.apiUrl);
  if (!c || !apiUrl || !safeDeviceToken(c.deviceToken)) return null;
  const aliases = c.projectAliases === undefined ? {} : objectRecord(c.projectAliases);
  if (!aliases || Object.keys(aliases).length > 100) return null;
  const projectAliases: Record<string, string> = {};
  for (const [folder, alias] of Object.entries(aliases)) {
    if (!safeAlias(folder) || !safeAlias(alias)) return null;
    projectAliases[folder] = alias as string;
  }
  for (const key of ["heartbeatIntervalMs", "idleThresholdMs"] as const) {
    const n = c[key];
    if (n !== undefined && (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > 86_400_000)) return null;
  }
  return { apiUrl, deviceToken: c.deviceToken, projectAliases,
    ...(c.heartbeatIntervalMs !== undefined ? { heartbeatIntervalMs: c.heartbeatIntervalMs as number } : {}),
    ...(c.idleThresholdMs !== undefined ? { idleThresholdMs: c.idleThresholdMs as number } : {}) };
}

export function configFingerprint(config: TrackerConfig): string {
  return createHash("sha256").update(JSON.stringify({ apiUrl: config.apiUrl, deviceToken: config.deviceToken,
    aliases: Object.entries(config.projectAliases).sort(([a], [b]) => a.localeCompare(b)),
    idle: idleThresholdMs(config) })).digest("hex");
}

export function readConfig(): TrackerConfig | null { return projectConfig(readJson<unknown>(CONFIG_PATH)); }
export function requireConfig(): TrackerConfig {
  const config = readConfig();
  if (!config) {
    console.error("Not logged in or config invalid. Run `vibehub-tracker login <deviceToken>` first.");
    process.exit(1);
  }
  return config;
}
export function writeConfig(config: TrackerConfig): void {
  const safe = projectConfig(config);
  if (!safe) throw new Error("Invalid tracker config.");
  writeJsonAtomic(CONFIG_PATH, safe);
}
export function deleteConfig(): void { removeFile(CONFIG_PATH); }
export function heartbeatIntervalMs(config: TrackerConfig): number {
  return config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
}
export function idleThresholdMs(config: TrackerConfig): number {
  return Math.min(config.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS, MAX_EVENT_AGE_MS);
}
