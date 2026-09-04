import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Adapter, Observation } from "./types";

const exec = promisify(execFile);

/**
 * Process-list adapter — knows an AI tool is *open*, and (on Windows) which
 * project from the main window title. Verified on this PC (2026-09, via
 * `Get-Process`; the same names came out of the old `tasklist /v`):
 *   Cursor       "Экраны … - deephold - Cursor"      → project "deephold"
 *   Code         "● file.ts - myrepo - Visual Studio Code"
 *   genui        "Quadcode AI"                        (Quadcode desktop)
 *   claude       (no window; the Claude Code log adapter carries the detail)
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
  // xAI Grok desktop/CLI. No log adapter, so it's presence-only with a null model.
  { tool: "grok", names: ["grok"], titleSuffixes: ["grok"] },
];

/**
 * tasklist /v reports *a* window title per process, and GUI/Electron apps (Cursor,
 * Code, Claude desktop, …) run several same-named processes — the one that answers
 * first is often a hidden OLE/IME/broadcast helper whose "title" is a Win32 window
 * *class* name, not anything a user typed. Those must never be read as a project
 * name (the `OleMainThreadWndName`-as-project bug). Matched case-insensitively;
 * anything here is treated as "no title".
 */
const JUNK_TITLE_PATTERNS: RegExp[] = [
  /wndname$/i, // OleMainThreadWndName, OleDdeWndName, …
  /^default ime$/i,
  /^msctfime ui$/i,
  /^m$/i,
  /^dde server window$/i,
  /gdi\+ window/i,
  /broadcasteventwindow/i, // .NET-BroadcastEventWindow.*
  /^cicmarshalwnd$/i,
  /mediacontextnotificationwindow/i,
  /^chrome_widgetwin/i,
  /^hidden window$/i,
  /^\.net-/i,
];

/** True when `title` is a real, user-meaningful window title (not junk/empty/N/A). */
export function isRealWindowTitle(title: string | null | undefined): title is string {
  const t = title?.trim();
  if (!t || t === "N/A") return false;
  return !JUNK_TITLE_PATTERNS.some((re) => re.test(t));
}

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

        // Prefer the process that owns a *real* window title — skip the hidden
        // OLE/IME/broadcast helpers whose "title" is a Win32 class name, so their
        // junk never leaks in as the project (see isRealWindowTitle / the
        // OleMainThreadWndName bug).
        const titled = matches.find((p) => isRealWindowTitle(p.title));
        const title = titled ? titled.title!.trim() : null;
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
          // The process exists right now, whatever its title last did.
          observedAt: now,
          // Presence-only tools burn no tokens we can see; log adapters own usage.
          tokensInputDelta: 0,
          tokensOutputDelta: 0,
          usage: [],
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

/** Every image name the rules watch (lower-case, no `.exe`) — the title-less pass of the PowerShell listing. */
const WATCHED_NAMES = [...new Set(RULES.flatMap((r) => r.names))];

/** A hung PowerShell must not stall the tick; on timeout we fall back to tasklist. */
const POWERSHELL_TIMEOUT_MS = 20_000;

/**
 * Windows. `tasklist /v` resolves every window title synchronously and was measured
 * at ~54 s per call on a busy machine — longer than the 30 s tick. One `Get-Process`
 * call takes well under a second (measured ~0.4 s here) and returns, as compact JSON:
 *  - every process that owns a main window title (editors, desktop apps — the title
 *    is what the project name is parsed from), and
 *  - every process whose image name is one we watch even without a window
 *    (`claude`/`codex` CLIs, Electron helpers), so log-backed tools still register
 *    as present.
 * `ProcessName` carries no `.exe`; a single match comes back as an object, not an
 * array. tasklist remains the fallback if PowerShell is missing, fails or times out.
 */
async function listWindows(): Promise<Proc[]> {
  try {
    return await listWindowsPowerShell();
  } catch {
    return listWindowsTasklist();
  }
}

async function listWindowsPowerShell(): Promise<Proc[]> {
  const names = WATCHED_NAMES.map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
  const script =
    `$n=@(${names}); Get-Process | Where-Object { $_.MainWindowTitle -or ($n -contains $_.ProcessName) } | ` +
    "Select-Object ProcessName, Id, MainWindowTitle | ConvertTo-Json -Compress";
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    timeout: POWERSHELL_TIMEOUT_MS,
  });
  const text = stdout.trim();
  if (!text) return []; // nothing matched → ConvertTo-Json prints nothing at all
  const parsed: unknown = JSON.parse(text);
  const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const out: Proc[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as { ProcessName?: unknown; Id?: unknown; MainWindowTitle?: unknown };
    if (typeof r.ProcessName !== "string" || typeof r.Id !== "number") continue;
    const title = typeof r.MainWindowTitle === "string" && r.MainWindowTitle.trim() ? r.MainWindowTitle : null;
    out.push({ name: r.ProcessName.toLowerCase(), pid: r.Id, title, cwd: null });
  }
  return out;
}

/** Fallback: `tasklist /v /fo csv` — Image Name, PID, …, Window Title (last column). Slow (see above). */
async function listWindowsTasklist(): Promise<Proc[]> {
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
  // Guard again here even though the caller already filters: this is exported and
  // unit-tested, and a junk title must never resolve to a project name.
  if (!isRealWindowTitle(title)) return null;
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
  if (!candidate || !isRealWindowTitle(candidate)) return null;
  // A real project/folder name has at least one alphanumeric char; reject pure
  // punctuation/whitespace leftovers.
  return /[a-z0-9]/i.test(candidate) ? candidate : null;
}
