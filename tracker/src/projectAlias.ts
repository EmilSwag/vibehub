import * as path from "node:path";
import type { TrackerConfig } from "./types";

export const HIDDEN = "hidden";
export const UNKNOWN_PROJECT_ALIAS = "unknown";

/**
 * Resolves the folder basename for a detected tool's cwd against the user's
 * override table (docs/ARCHITECTURE.md §3, §4.1). Returns `null` when the
 * project should be excluded from presence entirely (`"hidden"`).
 */
export function resolveProjectAlias(
  cwd: string | null,
  config: TrackerConfig
): string | null {
  if (!cwd) return UNKNOWN_PROJECT_ALIAS;
  const folderName = path.basename(cwd);
  const override = config.projectAliases?.[folderName];
  if (override === HIDDEN) return null;
  return override ?? folderName;
}
