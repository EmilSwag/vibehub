import { configFingerprint, readConfig } from "./config";
import { readJson, STATUS_PATH, writeJsonAtomic } from "./paths";
import { COLLECTION_POLICY, eventTime, isSupportedTool, MAX_EVENT_AGE_MS, MAX_USAGE_ENTRIES, objectRecord, safeAlias, safeModel } from "./privacy";
import type { SupportedTool } from "./privacy";
import type { StatusFile, StatusSource } from "./types";

export const OFFLINE_STATUS: StatusFile = { collectionPolicy: COLLECTION_POLICY, connected: false,
  status: "offline", projectAlias: null, tool: null, model: null, sessionStartedAt: null,
  updatedAt: new Date(0).toISOString(), sources: [] };

function iso(value: unknown): string | null {
  if (typeof value !== "string" || value.length !== 24) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) && new Date(at).toISOString() === value ? value : null;
}

/** Persist constructed metadata, never an object spread from logs or an old file. */
function projectStatus(value: unknown): StatusFile {
  const s = objectRecord(value);
  if (!s) return { ...OFFLINE_STATUS };
  const active = s.status === "active" && isSupportedTool(s.tool) && safeAlias(s.projectAlias) !== null;
  const sources: StatusSource[] = [];
  if (active && Array.isArray(s.sources)) for (const raw of s.sources.slice(0, MAX_USAGE_ENTRIES)) {
    const source = objectRecord(raw);
    if (!source || !isSupportedTool(source.tool) || eventTime(source.lastSeenAt, Date.now(), MAX_EVENT_AGE_MS) === null) continue;
    sources.push({ tool: source.tool, model: safeModel(source.model, source.tool), lastSeenAt: new Date(eventTime(source.lastSeenAt, Date.now(), MAX_EVENT_AGE_MS)!).toISOString() });
  }
  return { collectionPolicy: COLLECTION_POLICY,
    ...(typeof s.configFingerprint === "string" && /^[a-f0-9]{64}$/.test(s.configFingerprint)
      ? { configFingerprint: s.configFingerprint } : {}),
    // Constructed, never spread: a stale file cannot claim the receiver is on.
    ...(typeof s.attestedReceiver === "boolean" ? { attestedReceiver: s.attestedReceiver } : {}),
    connected: s.connected === true && iso(s.lastConnectionSeenAt) !== null &&
      eventTime(s.lastConnectionSeenAt, Date.now(), 90000) !== null,
    ...(iso(s.lastConnectionCheckAt) ? { lastConnectionCheckAt: iso(s.lastConnectionCheckAt)! } : {}),
    ...(iso(s.lastConnectionSeenAt) ? { lastConnectionSeenAt: iso(s.lastConnectionSeenAt)! } : {}),
    status: active ? "active" : s.status === "offline" ? "offline" : "idle",
    projectAlias: active ? safeAlias(s.projectAlias) : null,
    tool: active ? s.tool as string : null,
    model: active ? safeModel(s.model, s.tool as SupportedTool) : null,
    sessionStartedAt: active ? iso(s.sessionStartedAt) : null,
    updatedAt: iso(s.updatedAt) ?? new Date(0).toISOString(),
    ...(typeof s.authRejected === "boolean" ? { authRejected: s.authRejected } : {}), sources };
}

/** Old collector snapshots are NOT evidence, and are not used by CLI stop fallback. */
export function readStatus(): StatusFile {
  const raw = objectRecord(readJson<unknown>(STATUS_PATH));
  const config = readConfig();
  if (!raw || raw.collectionPolicy !== COLLECTION_POLICY || !config || raw.configFingerprint !== configFingerprint(config)) {
    return { ...OFFLINE_STATUS };
  }
  return projectStatus(raw);
}
export function writeStatus(status: StatusFile): void { writeJsonAtomic(STATUS_PATH, projectStatus(status)); }
export function writeOfflineStatus(): void {
  const config = readConfig();
  writeStatus({ ...OFFLINE_STATUS, ...(config ? { configFingerprint: configFingerprint(config) } : {}), updatedAt: new Date().toISOString() });
}
export function markAuthRejected(rejected: boolean): void {
  const config = readConfig();
  if (!config) return;
  const current = rejected ? OFFLINE_STATUS : readStatus();
  writeStatus({ ...current, configFingerprint: configFingerprint(config), authRejected: rejected,
    ...(rejected ? { connected: false } : {}), updatedAt: new Date().toISOString() });
}
