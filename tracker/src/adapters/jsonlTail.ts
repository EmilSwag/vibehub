import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";
import type { SupportedTool } from "../privacy";

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
const utf8 = new TextDecoder("utf-8", { fatal: true });

interface Cursor {
  dev: bigint;
  ino: bigint;
  offset: number;
  size: number;
  mtime: bigint;
  skipPartial: boolean;
  generation: number;
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
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<id>.jsonl
 * No custom roots, subagent recursion, linked roots/files, hard links, special
 * files, ancestor/project scans or contents outside these layouts. Missing or
 * unverifiable filesystem identity means unavailable, never a wider fallback.
 *
 * First sight / rotation / a backlog beyond MAX_BACKLOG_BYTES primes EOF and emits
 * nothing. Any smaller append is read in bounded chunks until caught up.
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
  private nextGeneration = 1;

  constructor(private readonly source: SupportedTool) {
    this.configRoot = path.join(this.home, source === "claude-code" ? ".claude" : ".codex");
    this.root = path.join(this.configRoot, source === "claude-code" ? "projects" : "sessions");
    this.overrideName = source === "claude-code" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
  }

  clear(): void { this.states.clear(); this.listed.clear(); }
  generation(file: string): number { return this.states.get(file)?.generation ?? 0; }

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
      if (isDirectory) return parts.length <= 1 && parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p));
      return parts.length === 2 && /^[A-Za-z0-9_-]+$/.test(parts[0]) && /^[A-Za-z0-9_-]+\.jsonl$/.test(parts[1]);
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

  /** Bounded directory metadata enumeration ONLY within the exact layouts above. */
  files(signal?: AbortSignal): string[] {
    this.listed.clear();
    let remaining = MAX_DIRECTORY_ENTRIES;
    const candidates: Array<{ file: string; mtime: number }> = [];
    const walk = (dir: string, depth: number): void => {
      if (signal?.aborted || remaining <= 0 || !this.checkedPath(dir, true)) return;
      let handle: fs.Dir | undefined;
      try {
        handle = fs.opendirSync(dir, { bufferSize: 16 });
        if (!this.checkedPath(dir, true)) return;
        const entries: fs.Dirent[] = [];
        let entry: fs.Dirent | null;
        while (remaining-- > 0 && !signal?.aborted && (entry = handle.readSync())) entries.push(entry);
        // Recent Codex date directories first; no arbitrary recursive tree walker.
        entries.sort((a, b) => b.name.localeCompare(a.name));
        for (const e of entries) {
          if (signal?.aborted) break;
          const file = path.join(dir, e.name);
          if (e.isSymbolicLink()) continue;
          if (e.isDirectory() && depth < (this.source === "claude-code" ? 1 : 3)) {
            walk(file, depth + 1);
          } else if (e.isFile()) {
            const s = this.checkedPath(file, false);
            if (s) candidates.push({ file, mtime: Number(s.mtimeMs) });
          }
        }
      } catch { /* Unreadable/unsupported layouts stay unavailable. */ }
      finally { try { handle?.closeSync(); } catch {} }
    };
    walk(this.root, 0);
    for (const { file } of candidates.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_LOG_FILES)) this.listed.add(file);
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
      skipPartial, generation: this.nextGeneration++ };
  }

  readNewLines(file: string, visit: (record: unknown, generation: number) => void, signal?: AbortSignal): void {
    if (signal?.aborted || !this.listed.has(file)) return;
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
