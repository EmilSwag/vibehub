import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { MAX_RECORD_AGE_MS, objectRecord, safeAlias, safeModel } from "../privacy";
import type { Adapter, Observation } from "./types";

/**
 * Quadcode AI — native local-read adapter (Round 4, PO decision).
 *
 * The contract is Claude's: parse transcript bytes locally, let only bounded metadata
 * leave. What differs is how a turn is DATED, and it is worth being exact about why.
 *
 * A Quadcode chat record's own `timestamp` is local ISO with no timezone, and on an
 * LLM record it marks the turn *start* — one measured record spanned 3h47m. It is
 * therefore never used as the instant of activity. Instead this adapter dates a reply
 * by OBSERVING ITS APPEND: the daemon is running, it holds a byte offset, a complete
 * LLM line appears past that offset, and the moment we see it is the moment we report.
 * That is bounded by the poll interval and, unlike a file mtime, it is tied to a
 * specific completed assistant record rather than to the file being touched.
 *
 * Two consequences follow, both deliberate:
 *   - A turn that finished while the tracker was not running is never counted. First
 *     sight primes at EOF, so history is not replayed and cannot be re-billed.
 *   - The record's own stamp is still read, for ONE purpose: discarding turns whose
 *     start is more than a day old. For that coarse, day-scale filter the log's local
 *     time is interpreted as this host's local time, which is correct because the same
 *     machine wrote it. It never becomes the reported instant, so no host offset is
 *     ever guessed for anything that leaves.
 *
 * Tokens: the format carries none — `meta_info.max_tokens` is a boolean flag and
 * `cluster_node_info` is a node id. Usage is therefore UNKNOWN and is emitted as an
 * empty list, never as a zero. `privacy.isTokenlessTool` enforces that downstream.
 *
 * Bodies (`message`) are never read out of the parsed line, never stored and never
 * forwarded; only method, timestamp, model id and variation index are touched.
 */

export const MAX_QUADCODE_FILES = 64;
export const MAX_QUADCODE_DIRECTORY_ENTRIES = 2048;
export const MAX_QUADCODE_CHUNK_BYTES = 4 * 1024 * 1024;
/** Quadcode embeds base64 uploads inline; a bigger line is skipped, never parsed. */
export const MAX_QUADCODE_LINE_BYTES = 1024 * 1024;
export const MAX_QUADCODE_RECORDS_PER_FILE = 256;
const MAX_QUADCODE_FILE_BYTES = 256 * 1024 * 1024;
const MAX_SEEN_FINGERPRINTS = 4096;
const utf8 = new TextDecoder("utf-8", { fatal: true });

const samePath = (a: string, b: string): boolean => process.platform === "win32"
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b);
const regularFile = (s: fs.BigIntStats): boolean => s.isFile() && !s.isSymbolicLink() &&
  s.nlink === 1n && s.ino > 0n && s.size >= 0n && s.size <= BigInt(MAX_QUADCODE_FILE_BYTES);

/** True when `dir` is the home directory or sits inside it. */
function withinHome(home: string, dir: string): boolean {
  const a = process.platform === "win32" ? path.resolve(home).toLowerCase() : path.resolve(home);
  const b = process.platform === "win32" ? path.resolve(dir).toLowerCase() : path.resolve(dir);
  const rel = path.relative(a, b);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Platform app-data root of the Quadcode desktop app, or `null` when the source is
 * unavailable. Documented in docs/ARCHITECTURE.md 4.5.
 *
 * The requested layout is honoured: `%APPDATA%` on Windows and `$XDG_CONFIG_HOME` on
 * Linux name the base when they are set, so a machine that keeps its app data
 * somewhere other than the default is found rather than silently skipped. macOS has
 * no such variable in the documented layout and is always home-relative.
 *
 * The discipline is `CLAUDE_CONFIG_DIR`s, not a free redirect: an env-provided base
 * that is relative, or that points outside the home directory, makes the whole source
 * UNAVAILABLE rather than being followed or quietly ignored. Failing closed matters
 * here - a sandboxed child process inherits the real profiles APPDATA even after HOME
 * has been redirected, and following it would walk a live users data during tests.
 */
export function quadcodeRoot(home = os.homedir()): string | null {
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "QuadcodeAI");
  const windows = process.platform === "win32";
  const override = process.env[windows ? "APPDATA" : "XDG_CONFIG_HOME"];
  const base = windows ? path.join(home, "AppData", "Roaming") : path.join(home, ".config");
  if (override === undefined || override === "") return path.join(base, "QuadcodeAI");
  if (!path.isAbsolute(override) || !withinHome(home, override)) return null;
  return path.join(override, "QuadcodeAI");
}

/** A chat-log path component: no separators, control characters or traversal. */
const safeComponent = (part: string): boolean =>
  part.length > 0 && part.length <= 200 && part !== "." && part !== ".." &&
  !/[\x00-\x1f\x7f\\/:]/.test(part);

/**
 * `<root>/apps/<Project>/.quadcodeai/.data/chats/<section>.files/chat_N.jsonl`
 *
 * Every level is pinned to a literal or a tight pattern, so this reader cannot walk
 * into an unrelated tree even if one is planted under the root. The `<Project>` level
 * is the only free component, and it is bounded to what `safeAlias` would accept
 * before it is ever used as a project hint.
 */
const LEVELS: ReadonlyArray<(part: string) => boolean> = [
  (p) => p === "apps",
  (p) => safeComponent(p) && safeAlias(p) !== null,
  (p) => p === ".quadcodeai",
  (p) => p === ".data",
  (p) => p === "chats",
  (p) => /^[A-Za-z0-9_-]+\.files$/.test(p),
];
const CHAT_FILE = /^chat_[0-9]+\.jsonl$/;

/**
 * Bounded reader for the Quadcode chat tree. Deliberately NOT `JsonlTailer`: that
 * reader is bound to the two native `~/.claude` / `~/.codex` layouts and must stay
 * that way — its path rules reject the dots in `.quadcodeai` by design. Cursors hold
 * numbers and booleans only, never a raw partial line.
 */
export class QuadcodeTailer {
  private readonly home: string;
  private states = new Map<string, { dev: bigint; ino: bigint; offset: number; size: number; mtime: bigint; skipPartial: boolean }>();
  private listed = new Set<string>();

  constructor(home = os.homedir()) { this.home = home; }

  /**
   * Resolved per call, not frozen at construction — the same discipline
   * `rootsAllowed()` already applies to `QUADCODE_HOME`. An app-data base that
   * changes under a running daemon must be re-judged, not trusted from start-up;
   * `files()` re-lists every poll, so a root change simply re-primes at EOF.
   */
  private currentRoot(): string | null { return quadcodeRoot(this.home); }

  clear(): void { this.states.clear(); this.listed.clear(); }

  /**
   * `QUADCODE_HOME` follows the `CLAUDE_CONFIG_DIR` rule exactly: it may be set, but
   * only to the real root. Anything else makes the whole source unavailable rather
   * than redirecting the reader somewhere it was never authorised to look.
   */
  private rootsAllowed(root: string | null): root is string {
    if (root === null) return false;
    const override = process.env.QUADCODE_HOME;
    if (override && (!path.isAbsolute(override) || !samePath(override, root))) return false;
    if (!path.isAbsolute(root) || /^(?:[\\]{2}|[/]{2})/.test(root)) return false;
    return this.unlinkedDirectory(root);
  }

  private unlinkedDirectory(dir: string): boolean {
    try {
      const s = fs.lstatSync(dir);
      return s.isDirectory() && !s.isSymbolicLink() && samePath(fs.realpathSync(dir), dir);
    } catch { return false; }
  }

  private layout(parts: string[], isDirectory: boolean): boolean {
    if (!parts.every(safeComponent)) return false;
    if (isDirectory) return parts.length <= LEVELS.length && parts.every((p, i) => LEVELS[i](p));
    return parts.length === LEVELS.length + 1 && parts.slice(0, LEVELS.length).every((p, i) => LEVELS[i](p)) &&
      CHAT_FILE.test(parts[LEVELS.length]);
  }

  private checkedPath(file: string, isDirectory: boolean): fs.BigIntStats | null {
    const root = this.currentRoot();
    if (!this.rootsAllowed(root)) return null;
    const relative = path.relative(root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    const parts = relative ? relative.split(path.sep) : [];
    if (!this.layout(parts, isDirectory)) return null;
    let current = root;
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

  /** The `<Project>` component of a listed chat file, already alias-safe, or null. */
  projectOf(file: string): string | null {
    const root = this.currentRoot();
    if (root === null) return null;
    const parts = path.relative(root, file).split(path.sep);
    return parts.length === LEVELS.length + 1 ? safeAlias(parts[1]) : null;
  }

  /** Bounded metadata enumeration strictly inside the documented layout. */
  files(signal?: AbortSignal): string[] {
    this.listed.clear();
    let remaining = MAX_QUADCODE_DIRECTORY_ENTRIES;
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
        for (const e of entries) {
          if (signal?.aborted) break;
          if (e.isSymbolicLink()) continue;
          const file = path.join(dir, e.name);
          if (e.isDirectory() && depth < LEVELS.length) walk(file, depth + 1);
          else if (e.isFile() && depth === LEVELS.length) {
            const s = this.checkedPath(file, false);
            if (s) candidates.push({ file, mtime: Number(s.mtimeMs) });
          }
        }
      } catch { /* Unreadable or unsupported layouts stay unavailable. */ }
      finally { try { handle?.closeSync(); } catch {} }
    };
    const root = this.currentRoot();
    if (root !== null) walk(root, 0);
    for (const { file } of candidates.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_QUADCODE_FILES)) this.listed.add(file);
    for (const file of this.states.keys()) if (!this.listed.has(file)) this.states.delete(file);
    return [...this.listed];
  }

  /** Emits only lines appended since the previous poll. First sight primes at EOF. */
  readNewLines(file: string, visit: (record: unknown) => void, signal?: AbortSignal): void {
    if (signal?.aborted || !this.listed.has(file)) return;
    let fd: number | undefined;
    try {
      const before = this.checkedPath(file, false);
      if (!before) { this.states.delete(file); return; }
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
      const s = fs.fstatSync(fd, { bigint: true });
      const after = this.checkedPath(file, false);
      if (!regularFile(s) || !after || s.dev !== before.dev || s.ino !== before.ino ||
          s.dev !== after.dev || s.ino !== after.ino || signal?.aborted) { this.states.delete(file); return; }
      const size = Number(s.size);
      const cursor = this.states.get(file);
      // No cursor, replaced file, truncation, a rewrite at the same length, or an
      // append too large to bound: re-prime at EOF and emit nothing. A turn that
      // completed while we were not watching is history, and history is not activity.
      if (!cursor || cursor.dev !== s.dev || cursor.ino !== s.ino || size < cursor.size ||
          (size === cursor.size && s.mtimeNs !== cursor.mtime) || size - cursor.offset > MAX_QUADCODE_CHUNK_BYTES) {
        let skipPartial = false;
        if (size > 0) {
          const last = Buffer.alloc(1);
          skipPartial = fs.readSync(fd, last, 0, 1, size - 1) !== 1 || last[0] !== 10;
        }
        this.states.set(file, { dev: s.dev, ino: s.ino, offset: size, size, mtime: s.mtimeNs, skipPartial });
        return;
      }
      if (size <= cursor.offset) return;
      const start = cursor.offset;
      const buffer = Buffer.alloc(size - start);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, start);
      const current = this.checkedPath(file, false);
      if (signal?.aborted || !current || current.dev !== s.dev || current.ino !== s.ino) { this.states.delete(file); return; }
      cursor.size = size;
      cursor.mtime = s.mtimeNs;
      let lineStart = 0;
      let records = 0;
      while (lineStart < bytes && !signal?.aborted) {
        const end = buffer.indexOf(10, lineStart);
        if (end < 0 || end >= bytes) break;
        if (!cursor.skipPartial && end - lineStart <= MAX_QUADCODE_LINE_BYTES && records++ < MAX_QUADCODE_RECORDS_PER_FILE) {
          try { visit(JSON.parse(utf8.decode(buffer.subarray(lineStart, end)))); }
          catch { /* No error text: a malformed line could quote prompt or tool output. */ }
        }
        cursor.skipPartial = false;
        lineStart = end + 1;
      }
      cursor.offset = start + lineStart;
      // No partial string is retained. A giant fragment is discarded through its next
      // newline without ever being parsed.
      if (cursor.skipPartial || bytes - lineStart > MAX_QUADCODE_LINE_BYTES) {
        cursor.offset = start + bytes;
        cursor.skipPartial = true;
      }
    } catch { this.states.delete(file); }
    finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
  }
}

/**
 * The record's own local-ISO stamp, as a local instant — used ONLY for the day-scale
 * staleness filter. A zoned string is NOT accepted here: this field is documented as
 * zoneless, and a zoned one means the record is not the shape we validated against.
 */
export function turnStartedAt(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 32 ||
      !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) return null;
  const at = Date.parse(value.replace(" ", "T").slice(0, 23));
  return Number.isFinite(at) ? at : null;
}

/** Metadata of one completed assistant turn. Never carries a body or a path. */
export interface QuadcodeTurn { startedAt: number; model: string | null; variation: number }

/**
 * Projects one parsed chat line into turn metadata, or null. Only `method`,
 * `timestamp`, `is_status_message`, `variation_index` and `variations[].model_name`
 * are consulted; `message` and `name` are never touched.
 */
export function projectChatRecord(value: unknown, now: number): QuadcodeTurn | null {
  const r = objectRecord(value);
  // Only a completed assistant reply is evidence. A USER line is a request, and a
  // status line is neither.
  if (!r || r.method !== "LLM" || r.is_status_message === true) return null;
  const startedAt = turnStartedAt(r.timestamp);
  if (startedAt === null) return null;
  // A turn that started more than a day ago is historical, whatever appended it.
  if (now - startedAt > MAX_RECORD_AGE_MS || startedAt > now + MAX_RECORD_AGE_MS) return null;
  const variation = Number.isSafeInteger(r.variation_index) && (r.variation_index as number) >= 0 &&
    (r.variation_index as number) < 64 ? r.variation_index as number : 0;
  const variations = Array.isArray(r.variations) ? r.variations : [];
  if (variations.length > 64) return null;
  const chosen = objectRecord(variations[variation]) ?? objectRecord(variations[0]);
  return { startedAt, model: safeModel(chosen?.model_name, "quadcode"), variation };
}

/**
 * Native Quadcode adapter. Emits activity + model; usage is always empty because no
 * measured count exists in the format.
 */
export class QuadcodeAdapter implements Adapter {
  readonly name = "quadcode";
  private readonly tailer: QuadcodeTailer;
  private seen = new Set<string>();

  /**
   * `_recentWindowMs` is accepted for symmetry with the other adapters but is not
   * used: freshness here is the append observation itself, which is always `now`.
   */
  constructor(_recentWindowMs: number, home?: string) {
    this.tailer = new QuadcodeTailer(home);
  }

  clear(): void { this.tailer.clear(); this.seen.clear(); }

  /**
   * The format carries no record id, so de-duplication uses a fingerprint over bounded
   * metadata plus the record's position in the tree. This is weaker than Claude's
   * `message.id` digest and is documented as such: two LLM records in one chat sharing
   * a microsecond timestamp, model and variation index would be counted once. It
   * exists to make a re-prime or a double read idempotent, not to identify a turn.
   */
  private fingerprint(file: string, project: string | null, turn: QuadcodeTurn): string {
    return createHash("sha256")
      .update(`${project ?? ""}\u0000${path.basename(file)}\u0000${turn.startedAt}\u0000${turn.model ?? ""}\u0000${turn.variation}`)
      .digest("hex");
  }

  async poll(now = Date.now(), signal?: AbortSignal): Promise<Observation[]> {
    if (signal?.aborted) return [];
    const out: Observation[] = [];
    for (const file of this.tailer.files(signal)) {
      if (signal?.aborted) break;
      const project = this.tailer.projectOf(file);
      let model: string | null = null;
      let fresh = false;
      this.tailer.readNewLines(file, (raw) => {
        const turn = projectChatRecord(raw, now);
        if (!turn) return;
        const digest = this.fingerprint(file, project, turn);
        if (this.seen.has(digest)) return;
        if (this.seen.size >= MAX_SEEN_FINGERPRINTS) this.seen.delete(this.seen.values().next().value as string);
        this.seen.add(digest);
        fresh = true;
        model = turn.model;
      }, signal);
      if (!fresh || signal?.aborted) continue;
      // Dated by observation of the append, NOT by the record's own start stamp.
      out.push({ tool: this.name, cwd: null, projectHint: project, model,
        confidence: "activity", lastActivityAt: now, observedAt: now,
        tokensInputDelta: 0, tokensOutputDelta: 0, usage: [] });
    }
    return signal?.aborted ? [] : out;
  }
}

/** Retired compatibility helpers: raw content is not a source of token counts. */
export function estimateTokens(_text: string): number { return 0; }
export function stripToolResults(_text: string): string { return ""; }
