import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Adapter, Observation } from "./types";

const exec = promisify(execFile);

/**
 * Process-list adapter — knows an AI tool is *open*, and (on Windows) which
 * project from the main window title. Verified on this PC (2026-09):
 *   Cursor.exe   "Экраны … - deephold - Cursor"      → project "deephold"
 *   Code.exe     "● file.ts - myrepo - Visual Studio Code"
 *   genui.exe    "Quadcode AI"                        (Quadcode desktop)
 *   claude.exe   (no window; the Claude Code log adapter carries the detail)
 *
 * Activity heuristic: a changing window title counts as activity; an unchanged
 * title for longer than `idleAfterMs` degrades to presence-only, so an editor
 * left open overnight doesn't read as "coding".
 */
interface ToolRule {
  tool: string;
  /** Lower-cased process image names (without .exe) or macOS bundle executables. */
  names: string[];
  /** Trailing app name in window titles, used to strip it off. */
  titleSuffixes: string[];
  /** Tools whose real activity is tracked by a log adapter → presence-only here. */
  logBacked?: boolean;
}

const RULES: ToolRule[] = [
  { tool: "cursor", names: ["cursor"], titleSuffixes: ["cursor"] },
  { tool: "vscode", names: ["code", "code - insiders"], titleSuffixes: ["visual studio code", "visual studio code - insiders"] },
  { tool: "windsurf", names: ["windsurf"], titleSuffixes: ["windsurf"] },
  { tool: "zed", names: ["zed"], titleSuffixes: ["zed"] },
  { tool: "quadcode", names: ["genui", "quadcode", "quadcode ai"], titleSuffixes: ["quadcode ai"] },
  { tool: "claude-code", names: ["claude"], titleSuffixes: [], logBacked: true },
  { tool: "codex", names: ["codex"], titleSuffixes: [], logBacked: true },
  { tool: "chatgpt", names: ["chatgpt"], titleSuffixes: ["chatgpt"] },
];

interface Seen {
  title: string | null;
  changedAt: number;
}

export class ProcessAdapter implements Adapter {
  name = "processes";
  private seen = new Map<string, Seen>();

  constructor(private idleAfterMs: number) {}

  async poll(): Promise<Observation[]> {
    try {
      const procs = process.platform === "win32" ? await listWindows() : await listUnix();
      const now = Date.now();
      const out = new Map<string, Observation>();

      for (const rule of RULES) {
        const matches = procs.filter((p) => rule.names.includes(p.name));
        if (matches.length === 0) continue;

        // Prefer the process that actually owns a titled window.
        const titled = matches.find((p) => p.title && p.title.trim() && p.title !== "N/A");
        const title = titled?.title?.trim() ?? null;
        const prev = this.seen.get(rule.tool);
        const changed = !prev || prev.title !== title;
        const changedAt = changed ? now : prev!.changedAt;
        this.seen.set(rule.tool, { title, changedAt });

        const idle = now - changedAt > this.idleAfterMs;
        out.set(rule.tool, {
          tool: rule.tool,
          cwd: titled?.cwd ?? matches.find((p) => p.cwd)?.cwd ?? null,
          projectHint: title ? projectFromTitle(title, rule.titleSuffixes) : null,
          model: null,
          lastActivityAt: changedAt,
          tokensInputDelta: 0,
          tokensOutputDelta: 0,
          confidence: rule.logBacked || idle || !title ? "presence" : "activity",
        });
      }
      return [...out.values()];
    } catch {
      return [];
    }
  }
}

interface Proc {
  name: string;
  pid: number;
  title: string | null;
  cwd: string | null;
}

/** Windows: `tasklist /v /fo csv` — Image Name, PID, …, Window Title (last column). */
async function listWindows(): Promise<Proc[]> {
  const { stdout } = await exec("tasklist", ["/v", "/fo", "csv", "/nh"], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  const out: Proc[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('"')) continue;
    const cols = line.slice(1, -1).split('","');
    if (cols.length < 9) continue;
    const image = cols[0].toLowerCase().replace(/\.exe$/, "");
    const title = cols[cols.length - 1];
    out.push({ name: image, pid: Number(cols[1]), title: title === "N/A" ? null : title, cwd: null });
  }
  return out;
}

/**
 * macOS/Linux: `ps -axo pid=,ppid=,comm=`. GUI editors have no useful cwd, but the
 * shells they spawn (integrated terminal) do, so we resolve the newest shell that
 * descends from the editor and read its cwd via lsof.
 */
async function listUnix(): Promise<Proc[]> {
  const { stdout } = await exec("ps", ["-axo", "pid=,ppid=,comm="], { maxBuffer: 8 * 1024 * 1024 });
  const rows = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) return null;
      const comm = m[3];
      const base = comm.split("/").pop() ?? comm;
      return { pid: Number(m[1]), ppid: Number(m[2]), name: base.toLowerCase(), comm };
    })
    .filter((r): r is { pid: number; ppid: number; name: string; comm: string } => r !== null);

  const children = new Map<number, number[]>();
  for (const r of rows) children.set(r.ppid, [...(children.get(r.ppid) ?? []), r.pid]);
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const shells = new Set(["zsh", "bash", "fish", "sh"]);

  const out: Proc[] = [];
  for (const r of rows) {
    if (r.name.includes("helper")) continue;
    const rule = RULES.find((x) => x.names.includes(r.name));
    if (!rule) continue;

    // Find the newest shell under this process tree (highest pid ≈ newest).
    let cwd: string | null = null;
    const stack = [...(children.get(r.pid) ?? [])];
    let best = -1;
    while (stack.length) {
      const pid = stack.pop()!;
      const p = byPid.get(pid);
      if (!p) continue;
      if (shells.has(p.name) && pid > best) best = pid;
      stack.push(...(children.get(pid) ?? []));
    }
    if (best > 0) cwd = await cwdOf(best);
    out.push({ name: r.name, pid: r.pid, title: null, cwd });
  }
  return out;
}

async function cwdOf(pid: number): Promise<string | null> {
  try {
    const { stdout } = await exec("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
    const line = stdout.split("\n").find((l) => l.startsWith("n"));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

/** "● index.ts - vibehub - Cursor" → "vibehub"; "Quadcode AI" → null (no project in title). */
export function projectFromTitle(title: string, suffixes: string[]): string | null {
  let t = title.replace(/^[●•*]\s*/, "").trim();
  const lower = t.toLowerCase();
  for (const s of suffixes) {
    if (lower.endsWith(` - ${s}`)) {
      t = t.slice(0, t.length - s.length - 3).trim();
      break;
    }
    if (lower === s) return null;
  }
  if (!t) return null;
  const parts = t.split(" - ").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // "<file> - <project>" → project; "<project>" → project. Strip "[Administrator]" etc.
  const candidate = parts[parts.length - 1].replace(/\s*\[.*?\]\s*$/, "").trim();
  return candidate || null;
}
