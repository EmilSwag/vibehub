import { readJson, STATUS_PATH, writeJsonAtomic } from "./paths";
import type { StatusFile } from "./types";

export const OFFLINE_STATUS: StatusFile = {
  status: "offline",
  projectAlias: null,
  tool: null,
  model: null,
  sessionStartedAt: null,
  updatedAt: new Date(0).toISOString(),
};

/** Reads status.json, or a fresh "offline" snapshot if it has never been written. */
export function readStatus(): StatusFile {
  const status = readJson<StatusFile>(STATUS_PATH);
  return status ?? { ...OFFLINE_STATUS, updatedAt: new Date().toISOString() };
}

export function writeStatus(status: StatusFile): void {
  writeJsonAtomic(STATUS_PATH, status);
}

export function writeOfflineStatus(): void {
  writeStatus({ ...OFFLINE_STATUS, updatedAt: new Date().toISOString() });
}
