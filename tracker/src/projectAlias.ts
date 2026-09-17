import { folderFromCwd, safeAlias } from "./privacy";
import type { TrackerConfig } from "./types";

export const HIDDEN = "hidden";
export const UNKNOWN_PROJECT_ALIAS = "unknown";

/**
 * Only an explicit user alias is disclosed. The optional folder hint comes from
 * a supported AI record, never a title, repository lookup or a file read. A
 * basename may be confidential too, so the default is the neutral "unknown".
 * "hidden" excludes that source's presence AND usage before aggregation.
 */
export function resolveProjectAlias(cwd: string | null, config: TrackerConfig, hint: string | null = null): string | null {
  const folder = folderFromCwd(cwd) ?? safeAlias(hint);
  const matches = folder ? Object.entries(config.projectAliases ?? {})
    .filter(([key]) => key.toLowerCase() === folder.toLowerCase()).map(([, value]) => value) : [];
  if (matches.includes(HIDDEN)) return null;
  return (matches.length === 1 ? safeAlias(matches[0]) : null) ?? UNKNOWN_PROJECT_ALIAS;
}
