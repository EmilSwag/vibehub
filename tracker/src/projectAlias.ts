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
  config: TrackerConfig,
  /** Project label parsed from a window title when the tool exposes no cwd. */
  hint: string | null = null
): string | null {
  const folderName = cwd ? path.basename(cwd) : hint?.trim() || null;
  if (!folderName) return UNKNOWN_PROJECT_ALIAS;
  const override = config.projectAliases?.[folderName];
  if (override === HIDDEN) return null;
  // Server schema caps aliases at 64 chars.
  return (override ?? folderName).slice(0, 64);
}
