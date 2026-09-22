import { createHash } from "node:crypto";
import { CONFIG_PATH, readJson, removeFile, writeJsonAtomic } from "./paths";
import { ATTESTED_TOOLS, isAttestedTool, MAX_EVENT_AGE_MS, objectRecord, safeAlias, safeApiOrigin, safeDeviceToken } from "./privacy";
import type { AttestedMetadataConfig, AutostartPreference, TrackerConfig } from "./types";

/**
 * The opt-in receiver switch. Anything malformed is a hard `null` (the whole config
 * is rejected) rather than a silent downgrade, so a typo can never leave the user
 * believing they opted in — or out. Only receiver-eligible tool ids may be listed
 * (`ATTESTED_TOOLS`): Claude Code and Codex must come from their own log adapters,
 * never from a file another process writes, or a producer could assert activity that
 * never happened. `quadcode` is listable here *and* collected natively — the two
 * paths coexist, and the native one needs no consent flag because it reads nothing a
 * user did not already install.
 *
 * Round 5: `cursor` and `windsurf` are listable and receiver-only. `hooks install`
 * writes this entry itself, so consent and the IDE-side hook are turned on together —
 * and consent alone still collects nothing, because without the hook nobody writes the
 * inbox, and without the inbox the receiver has nothing to read.
 */
export function projectAttestedMetadata(value: unknown): AttestedMetadataConfig | null | "invalid" {
  if (value === undefined) return null;
  const a = objectRecord(value);
  if (!a || typeof a.enabled !== "boolean" || !Array.isArray(a.tools) ||
      a.tools.length > ATTESTED_TOOLS.length) return "invalid";
  const tools: string[] = [];
  for (const tool of a.tools) {
    if (!isAttestedTool(tool) || tools.includes(tool)) return "invalid";
    tools.push(tool);
  }
  return { enabled: a.enabled, tools };
}

/**
 * The standing autostart answer. Same strictness as every other optional field here -
 * a shape we do not recognise rejects the whole file rather than being read as a
 * preference the user never expressed. Getting this wrong in the permissive direction
 * would mean a typo silently re-enabling a login item somebody switched off.
 */
export function projectAutostart(value: unknown): AutostartPreference | null | "invalid" {
  if (value === undefined) return null;
  const a = objectRecord(value);
  if (!a || typeof a.enabled !== "boolean" || Object.keys(a).length !== 1) return "invalid";
  return { enabled: a.enabled };
}

/**
 * True only for an explicit `autostart disable`. An absent entry is not an opt-out: it
 * means the question has never been answered, and `start` registers autostart then.
 */
export function autostartOptedOut(config: TrackerConfig | null): boolean {
  return config?.autostart?.enabled === false;
}

/** True only when the switch is on AND at least one tool was explicitly listed. */
export function attestedToolsFor(config: TrackerConfig): string[] {
  const a = config.attestedMetadata;
  return a?.enabled ? [...a.tools] : [];
}

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
  const attested = projectAttestedMetadata(c.attestedMetadata);
  if (attested === "invalid") return null;
  const autostart = projectAutostart(c.autostart);
  if (autostart === "invalid") return null;
  return { apiUrl, deviceToken: c.deviceToken, projectAliases,
    ...(c.heartbeatIntervalMs !== undefined ? { heartbeatIntervalMs: c.heartbeatIntervalMs as number } : {}),
    ...(c.idleThresholdMs !== undefined ? { idleThresholdMs: c.idleThresholdMs as number } : {}),
    ...(attested ? { attestedMetadata: attested } : {}),
    ...(autostart ? { autostart } : {}) };
}

/** Records the standing autostart answer, leaving every other field exactly as it was. */
export function setAutostartPreference(config: TrackerConfig, enabled: boolean): TrackerConfig {
  const next: TrackerConfig = { ...config, autostart: { enabled } };
  writeConfig(next);
  return next;
}

/**
 * Deliberately blind to `autostart`: the fingerprint fences COLLECTED state, so that
 * records gathered under one account or consent setting cannot survive into another.
 * When the tracker starts changes nothing about what it collects, and folding it in
 * would discard the daemon's status snapshot every time the preference moved.
 */
export function configFingerprint(config: TrackerConfig): string {
  return createHash("sha256").update(JSON.stringify({ apiUrl: config.apiUrl, deviceToken: config.deviceToken,
    aliases: Object.entries(config.projectAliases).sort(([a], [b]) => a.localeCompare(b)),
    // Flipping the receiver switch (or its tool list) re-fences collected state, so
    // records accepted under one consent setting cannot survive into another.
    attested: attestedToolsFor(config).slice().sort(),
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
