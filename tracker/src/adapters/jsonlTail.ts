import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";
import { MAX_RECORD_AGE_MS, type SupportedTool } from "../privacy";

export const MAX_LOG_FILES = 128;
export const MAX_DIRECTORY_ENTRIES = 2048;
/**
 * QA fix (R3): the most bytes one poll reads from one file. A bigger append is no
 * longer a reason to jump to EOF (which silently dropped every token in it - a single
 * tool result can be megabytes); the reader catches up chunk by chunk over the next
 * polls instead. Only a backlog beyond MAX_BACKLOG_BYTES (a bulk rewrite, not a live
 * session) is still skipped.
 */
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_BACKLOG_BYTES = 64 * 1024 * 1024;
export const MAX_LINE_BYTES = 256 * 1024;
/** Records parsed per file per poll. Past the cap the reader STOPS and resumes next poll. */
export const MAX_RECORDS_PER_FILE = 4096;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
/**
 * L1 follow-up (U2): Claude Code writes subagent transcripts beside the session, at
 * projects/<project>/<session>/subagents/**.jsonl (observed: subagents/agent-*.jsonl and
 * subagents/workflows/wf_*\/agent-*.jsonl). Discovery has its OWN per-poll budget so a
 * big subagent tree can never starve the top-level listing or approach the tick
 * watchdog: at most this many directory levels below `subagents/`, directories visited
 * and entries enumerated per poll. Only directories/files touched within
 * MAX_RECORD_AGE_MS are considered - nothing older can be counted anyway.
 */
export const MAX_SUBAGENT_DEPTH = 5;
export const MAX_SUBAGENT_DIRS_PER_POLL = 256;
export const MAX_SUBAGENT_ENTRIES_PER_POLL = 2048;
const NAME = /^[A-Za-z0-9_-]+$/;
const LOG_NAME = /^[A-Za-z0-9_-]+\.jsonl$/;
const utf8 = new TextDecoder("utf-8", { fatal: true });

interface Cursor {
  dev: bigint;
  ino: bigint;
  offset: number;
  size: number;
  mtime: bigint;
  skipPartial: boolean;
  generation: number;
  /** Read from byte 0 (a file that appeared or changed since the last poll), not primed at EOF. */
  fromStart: boolean;
  /** Created since the last poll: its counters (Codex totals) start at zero, not at a baseline. */
  bornFresh: boolean;
}

const samePath = (a: string, b: string): boolean => process.platform === "win32"
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b);
const sameFile = (a: fs.BigIntStats, b: fs.BigIntStats): boolean => a.dev === b.dev && a.ino === b.ino;
const regularFile = (s: fs.BigIntStats): boolean => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n &&
  s.ino > 0n && s.size >= 0n && s.size <= BigInt(MAX_FILE_BYTES);

/**
 * The only AI-file reader. Exact supported layouts:
 *   ~/.claude/projects/<encoded-project>/<session>.jsonl
 *   ~/.claude/projects/<encoded-project>/<session>/subagents/[<dir>/ x0..5]<agent>.jsonl
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<id>.jsonl
 * No custom roots, other recursion, linked roots/files, hard links, special files,
 * ancestor/project scans or contents outside these layouts. Missing or unverifiable
 * filesystem identity means unavailable, never a wider fallback.
 *
 * L1 follow-up (U1): only the FIRST poll with no cursor state (daemon start, or after
 * clear()) primes files at EOF - that is history, never replayed. After that, a file
 * with no cursor that was modified since the previous poll is new work and is read
 * from byte 0; before this, a session's or subagent's first writes were skipped because
 * the file was primed at the size it had when first seen. Rotation, truncation and a
 * backlog beyond MAX_BACKLOG_BYTES still prime EOF. Any other append is read in bounded
 * chunks until caught up.
 * Complete JSONL strings (which MAY contain prompts/code/tool output) are read
 * and parsed transiently. Only the visitor's explicit metadata projection may
 * survive a call. Cursors contain numbers/booleans, NEVER raw partial lines.
 */
export class JsonlTailer {
  private readonly home = path.resolve(os.homedir());
  private readonly configRoot: string;
  private readonly root: string;
  private readonly overrideName: "CLAUDE_CONFIG_DIR" | "CODEX_HOME";
  private states = new Map<string, Cursor>();
  private listed = new Set<string>();
  /** The metadata `files()` saw, so an unchanged file is skipped without opening it. */
  private listedStats = new Map<string, fs.BigIntStats>();
  private nextGeneration = 1;
  /** Start of the latest `files()` call, and of the one before it (null = no state yet). */
  private lastPollAt: number | null = null;
  private previousPollAt: number | null = null;

  constructor(private readonly source: SupportedTool) {
    this.configRoot = path.join(this.home, source === "claude-code" ? ".claude" : ".codex");
    this.root = path.join(this.configRoot, source === "claude-code" ? "projects" : "sessions");
    this.overrideName = source === "claude-code" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
  }

  clear(): void {
    this.states.clear(); this.listed.clear(); this.listedStats.clear();
    // Forgetting cursors makes the next poll a first run again: everything is primed,
    // nothing is replayed (consent/config/account changes rely on that).
    this.lastPollAt = null; this.previousPollAt = null;
  }
  generation(file: string): number { return this.states.get(file)?.generation ?? 0; }
  /** True while this file's current generation was created since the previous poll (Codex zero baseline). */
  bornFresh(file: string): boolean { return this.states.get(file)?.bornFresh === true; }

  /**
   * For a subagent transcript: its parent session file and project directory, so the
   * adapter can attribute the work to the parent's project. null for any other file.
   */
  subagentParent(file: string): { sessionFile: string; projectDir: string } | null {
    if (this.source !== "claude-code") return null;
    const parts = path.relative(this.root, file).split(path.sep);
    if (parts.length < 4 || parts[2] !== "subagents") return null;
    return { sessionFile: path.join(this.root, parts[0], `${parts[1]}.jsonl`), projectDir: parts[0] };
  }
  /** The encoded project directory a Claude file lives under. */
  projectDir(file: string): string | null {
    const parts = path.relative(this.root, file).split(path.sep);
    return this.source === "claude-code" && parts.length >= 2 ? parts[0] : null;
  }

  private rootsAllowed(): boolean {
    const override = process.env[this.overrideName];
    if (override && (!path.isAbsolute(override) || !samePath(override, this.configRoot))) return false;
    // Network/device namespace homes are not a documented local source.
    if (!path.isAbsolute(this.home) || /^(?:\\\\|\/\/)/.test(this.home)) return false;
    return [this.home, this.configRoot, this.root].every((dir) => this.unlinkedDirectory(dir));
  }

  private unlinkedDirectory(dir: string): boolean {
    try {
      const s = fs.lstatSync(dir);
      return s.isDirectory() && !s.isSymbolicLink() && samePath(fs.realpathSync(dir), dir);
    } catch { return false; }
  }

  private layout(parts: string[], isDirectory: boolean): boolean {
    if (parts.some((p) => !p || p.length > 200 || /[\x00-\x20\x7f\\/:]/.test(p) || p === "." || p === "..")) return false;
    if (this.source === "claude-code") {
      // [project] | [project, session] | [project, session, "subagents", ...up to 5 dirs]
      const dirs = isDirectory ? parts : parts.slice(0, -1);
      if (!dirs.every((p) => NAME.test(p))) return false;
      if (dirs.length > 2 && (dirs[2] !== "subagents" || dirs.length > 3 + MAX_SUBAGENT_DEPTH)) return false;
      if (isDirectory) return dirs.length <= 3 + MAX_SUBAGENT_DEPTH;
      // A transcript sits directly in a project, or anywhere inside a session's subagents/.
      return LOG_NAME.test(parts[parts.length - 1]) && (dirs.length === 1 || dirs.length >= 3);
    }
    const directories = [/^\d{4}$/, /^(?:0[1-9]|1[0-2])$/, /^(?:0[1-9]|[12]\d|3[01])$/];
    const count = isDirectory ? parts.length : parts.length - 1;
    if (count > 3 || (!isDirectory && count !== 3)) return false;
    if (!parts.slice(0, count).every((p, i) => directories[i].test(p))) return false;
    return isDirectory || /^rollout-[A-Za-z0-9_-]+\.jsonl$/.test(parts[3]);
  }

  private checkedPath(file: string, isDirectory: boolean): fs.BigIntStats | null {
    if (!this.rootsAllowed()) return null;
    const relative = path.relative(this.root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    const parts = relative ? relative.split(path.sep) : [];
    if (!this.layout(parts, isDirectory)) return null;
    let current = this.root;
    for (const part of (isDirectory ? parts : parts.slice(0, -1))) {
      current = path.join(current, part);
      if (!this.unlinkedDirectory(current)) return null;
    }
    try {
      const s = fs.lstatSync(file, { bigint: true });
      if (isDirectory ? !s.isDirectory() || s.isSymbolicLink() : !regularFile(s)) return null;
      return samePath(fs.realpathSync(file), file) ? s : null;
    } catch { return null; }
  }

  /**
   * A file found by the walk inside a directory the walk has just verified: layout,
   * plain regular file and no link. Cheaper than checkedPath (which re-verifies every
   * ancestor) - readNewLines still runs the full check before any byte is read.
   */
  private listedFile(file: string): fs.BigIntStats | null {
    const relative = path.relative(this.root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !this.layout(relative.split(path.sep), false)) return null;
    try {
      const s = fs.lstatSync(file, { bigint: true });
      return regularFile(s) && samePath(fs.realpathSync(file), file) ? s : null;
    } catch { return null; }
  }

  /** Bounded directory metadata enumeration ONLY within the exact layouts above. */
  files(signal?: AbortSignal): string[] {
    const started = Date.now();
    this.previousPollAt = this.lastPollAt;
    this.lastPollAt = started;
    this.listed.clear();
    this.listedStats.clear();
    let remaining = MAX_DIRECTORY_ENTRIES;
    const sub = { dirs: MAX_SUBAGENT_DIRS_PER_POLL, entries: MAX_SUBAGENT_ENTRIES_PER_POLL };
    const recent = started - MAX_RECORD_AGE_MS;
    const candidates: Array<{ file: string; stats: fs.BigIntStats }> = [];
    const readEntries = (dir: string, take: () => boolean): fs.Dirent[] => {
      let handle: fs.Dir | undefined;
      const entries: fs.Dirent[] = [];
      try {
        handle = fs.opendirSync(dir, { bufferSize: 16 });
        if (!this.checkedPath(dir, true)) return [];
        let entry: fs.Dirent | null;
        while (!signal?.aborted && take() && (entry = handle.readSync())) entries.push(entry);
      } catch { /* Unreadable/unsupported layouts stay unavailable. */ }
      finally { try { handle?.closeSync(); } catch {} }
      // Recent Codex date directories first; no arbitrary recursive tree walker.
      return entries.sort((a, b) => b.name.localeCompare(a.name));
    };
    const addFile = (file: string, minMtime = -Infinity): number | null => {
      const s = this.listedFile(file);
      if (!s || Number(s.mtimeMs) < minMtime) return null;
      candidates.push({ file, stats: s });
      return Number(s.mtimeMs);
    };
    const recentDir = (dir: string): boolean => {
      try { return Number(fs.lstatSync(dir).mtimeMs) >= recent; } catch { return false; }
    };
    // subagents/** : own budget, recent directories and files only, bounded depth.
    const walkSubagents = (dir: string, level: number): void => {
      if (signal?.aborted || sub.dirs-- <= 0 || !this.checkedPath(dir, true)) return;
      for (const e of readEntries(dir, () => sub.entries-- > 0)) {
        if (signal?.aborted) break;
        const child = path.join(dir, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isFile()) addFile(child, recent);
        else if (e.isDirectory() && level < MAX_SUBAGENT_DEPTH && recentDir(child)) walkSubagents(child, level + 1);
      }
    };
    const walk = (dir: string, depth: number): void => {
      if (signal?.aborted || remaining <= 0 || !this.checkedPath(dir, true)) return;
      const entries = readEntries(dir, () => remaining-- > 0);
      const sessionMtime = new Map<string, number>();
      const sessionDirs: string[] = [];
      for (const e of entries) {
        if (signal?.aborted) break;
        const file = path.join(dir, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory() && depth < (this.source === "claude-code" ? 1 : 3)) {
          walk(file, depth + 1);
        } else if (e.isDirectory() && this.source === "claude-code" && depth === 1 && NAME.test(e.name)) {
          sessionDirs.push(e.name);
        } else if (e.isFile()) {
          const mtime = addFile(file);
          if (mtime !== null && e.name.endsWith(".jsonl")) sessionMtime.set(e.name.slice(0, -6), mtime);
        }
      }
      // A session's subagents are only worth a look while the session (or its folder)
      // was touched within the counting window; everything else is skipped unopened.
      for (const name of sessionDirs) {
        if (signal?.aborted) break;
        const sessionDir = path.join(dir, name);
        if ((sessionMtime.get(name) ?? -Infinity) < recent && !recentDir(sessionDir)) continue;
        const subagents = path.join(sessionDir, "subagents");
        if (recentDir(subagents) || (sessionMtime.get(name) ?? -Infinity) >= recent) walkSubagents(subagents, 0);
      }
    };
    if (this.rootsAllowed()) walk(this.root, 0);
    for (const { file, stats } of candidates.sort((a, b) => Number(b.stats.mtimeMs) - Number(a.stats.mtimeMs)).slice(0, MAX_LOG_FILES)) {
      this.listed.add(file);
      this.listedStats.set(file, stats);
    }
    for (const file of this.states.keys()) if (!this.listed.has(file)) this.states.delete(file);
    return [...this.listed];
  }

  private prime(fd: number, s: fs.BigIntStats): Cursor {
    const size = Number(s.size); // regularFile already bounded this below MAX_FILE_BYTES
    let skipPartial = false;
    if (size > 0) {
      const last = Buffer.alloc(1);
      skipPartial = fs.readSync(fd, last, 0, 1, size - 1) !== 1 || last[0] !== 10;
    }
    return { dev: s.dev, ino: s.ino, offset: size, size, mtime: s.mtimeNs,
      skipPartial, generation: this.nextGeneration++, fromStart: false, bornFresh: false };
  }

  /** A cursor at byte 0 for a file that is new work since the previous poll (U1). */
  private fromStart(s: fs.BigIntStats, since: number): Cursor {
    const born = Number(s.birthtimeMs);
    // size 0 + the real mtime: an empty new file is not mistaken for a rewrite next poll.
    return { dev: s.dev, ino: s.ino, offset: 0, size: 0, mtime: s.mtimeNs, skipPartial: false,
      generation: this.nextGeneration++, fromStart: true,
      // birthtime is 0/unknown on some filesystems: then it is NOT fresh and a Codex
      // file keeps the safe baseline rule rather than recounting its totals.
      bornFresh: born > 0 && born >= since };
  }

  readNewLines(file: string, visit: (record: unknown, generation: number) => void, signal?: AbortSignal): void {
    if (signal?.aborted || !this.listed.has(file)) return;
    // Skip unchanged: a caught-up cursor whose file `files()` saw with the same identity,
    // size and mtime has nothing to read - no open, no re-verification this poll.
    const seen = this.listedStats.get(file);
    const known = this.states.get(file);
    if (seen && known && known.dev === seen.dev && known.ino === seen.ino && known.offset === known.size &&
        BigInt(known.size) === seen.size && known.mtime === seen.mtimeNs) return;
    let fd: number | undefined;
    try {
      const before = this.checkedPath(file, false);
      if (!before) { this.states.delete(file); return; }
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
      const s = fs.fstatSync(fd, { bigint: true });
      const after = this.checkedPath(file, false);
      if (!regularFile(s) || !after || !sameFile(before, s) || !sameFile(s, after) || signal?.aborted) {
        this.states.delete(file); return;
      }
      const size = Number(s.size);
      let cursor = this.states.get(file);
      // U1: no cursor after the first poll = a file that appeared (or re-entered the
      // listing) since then. If it changed since the previous poll STARTED it is new work:
      // read it from byte 0, within the same backlog bound as any append. No slack: a file
      // written before that listing began was either listed then (and has a cursor) or is
      // history, and history is never replayed.
      const since = this.previousPollAt;
      if (!cursor && since !== null && Number(s.mtimeMs) >= since && size <= MAX_BACKLOG_BYTES) {
        cursor = this.fromStart(s, since);
        this.states.set(file, cursor);
      }
      if (!cursor || cursor.dev !== s.dev || cursor.ino !== s.ino || size < cursor.size ||
          (size === cursor.size && s.mtimeNs !== cursor.mtime) || size - cursor.offset > MAX_BACKLOG_BYTES) {
        this.states.set(file, this.prime(fd, s));
        return;
      }
      if (size <= cursor.offset) return;
      const start = cursor.offset;
      const buffer = Buffer.alloc(Math.min(size - start, MAX_CHUNK_BYTES));
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, start);
      const current = this.checkedPath(file, false);
      if (signal?.aborted || !current || !sameFile(s, current)) { this.states.delete(file); return; }
      let lineStart = 0;
      let records = 0;
      while (lineStart < bytes && !signal?.aborted) {
        const end = buffer.indexOf(10, lineStart);
        if (end < 0 || end >= bytes) break;
        if (!cursor.skipPartial && end - lineStart <= MAX_LINE_BYTES) {
          // Out of budget: stop BEFORE this line and resume from it next poll.
          if (records++ >= MAX_RECORDS_PER_FILE) break;
          try { visit(JSON.parse(utf8.decode(buffer.subarray(lineStart, end))), cursor.generation); }
          catch { /* No error text: it could contain a raw log line or local path. */ }
        }
        cursor.skipPartial = false;
        lineStart = end + 1;
      }
      cursor.offset = start + lineStart;
      // The cursor only counts as caught up once it has consumed everything it saw;
      // until then `size`/`mtime` stay at their previous values so a rewrite check
      // (same size, new mtime) cannot mistake an unread tail for a rewritten file.
      if (start + bytes >= size) { cursor.size = size; cursor.mtime = s.mtimeNs; }
      // No partial string is retained. Re-read a small incomplete line next poll;
      // discard a giant fragment through its next newline without parsing it.
      if (records <= MAX_RECORDS_PER_FILE && (cursor.skipPartial || bytes - lineStart > MAX_LINE_BYTES)) {
        cursor.offset = start + bytes;
        cursor.skipPartial = true;
      }
    } catch { this.states.delete(file); }
    finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
  }
}
