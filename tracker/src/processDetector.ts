import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import type { DetectedActivity } from "./types";

/**
 * Configurable list of known coding-tool process names, per
 * docs/ARCHITECTURE.md §4.2. Matched case-insensitively against the process
 * name reported by the OS (which may include a `.exe` suffix on Windows).
 */
export const DEFAULT_TOOL_PROCESS_NAMES = ["claude", "cursor", "code"];

interface RawProcess {
  pid: number;
  name: string;
}

function listProcessesWindows(): RawProcess[] {
  const out = execFileSync("tasklist", ["/fo", "csv", "/nh"], {
    encoding: "utf8",
  });
  const processes: RawProcess[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.split('","').map((f) => f.replace(/^"|"$/g, ""));
    const [name, pidStr] = fields;
    const pid = Number(pidStr);
    if (name && Number.isFinite(pid)) processes.push({ pid, name });
  }
  return processes;
}

function listProcessesPosix(): RawProcess[] {
  const out = execFileSync("ps", ["-axo", "pid=,comm="], { encoding: "utf8" });
  const processes: RawProcess[] = [];
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const name = match[2].split("/").pop() ?? match[2];
    processes.push({ pid, name });
  }
  return processes;
}

/** Best-effort process list. Returns [] rather than throwing on any OS/shell error. */
function listProcesses(): RawProcess[] {
  try {
    return process.platform === "win32"
      ? listProcessesWindows()
      : listProcessesPosix();
  } catch {
    return [];
  }
}

/**
 * Best-effort cwd resolution for a pid. Linux reads the /proc symlink; macOS
 * shells out to `lsof`; Windows has no simple unprivileged equivalent, so it
 * degrades to `null` (caller falls back to a `"unknown"` projectAlias) — see
 * tracker/README.md "Process detection adapters".
 */
function resolveCwd(pid: number): string | null {
  try {
    if (os.platform() === "linux") {
      return fs.readlinkSync(`/proc/${pid}/cwd`);
    }
    if (os.platform() === "darwin") {
      const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
        encoding: "utf8",
      });
      const line = out.split(/\r?\n/).find((l) => l.startsWith("n"));
      return line ? line.slice(1) : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Scans the process list for the first running process whose name matches one
 * of `toolNames` (case-insensitive substring match, so `code` matches
 * `Code.exe`). Returns null when none of the configured tools are running.
 */
export function detectActiveTool(
  toolNames: string[] = DEFAULT_TOOL_PROCESS_NAMES
): DetectedActivity | null {
  const processes = listProcesses();
  const lowerNames = toolNames.map((n) => n.toLowerCase());
  const match = processes.find((p) => {
    const name = p.name.toLowerCase();
    return lowerNames.some((n) => name.includes(n));
  });
  if (!match) return null;
  return { tool: match.name, pid: match.pid, cwd: resolveCwd(match.pid) };
}
