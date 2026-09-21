import fs from "node:fs";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { ATTESTED_PATH, configDirSafe } from "../paths";
import { eventTime, isAttestedTool, isCount, isTokenlessTool, objectRecord, safeAlias, safeModel } from "../privacy";
import type { SupportedTool } from "../privacy";
import type { Adapter, Observation } from "./types";

/**
 * A RECEIVER, not a producer.
 *
 * This module discovers nothing and derives nothing. It accepts already-dated,
 * already-measured metadata that a SEPARATE, user-installed producer wrote to
 * `~/.vibehub/attested.jsonl`, and only while the user switched the receiver on in
 * `config.json` (`attestedMetadata.enabled` + an explicit `tools` list). With the
 * switch off, nothing here opens a file descriptor.
 *
 * It exists because some tools have no source this repo can honestly read. Quadcode
 * AI is the worked example: its documented chat schema cannot date an AI request or
 * response (local-ISO timestamps with no timezone; an LLM record's stamp is the turn
 * *start*, one measured record spanning 3h47m), so the only thing that would date a
 * reply is the file append — a filesystem heuristic. Rather than revive that, the
 * tracker lets a producer that genuinely knows when a turn completed say so.
 *
 * Non-negotiables enforced below, every one of them fail-closed:
 *   - `occurredAt` must be a real instant (`Z` or `±HH:MM`). A local timestamp with
 *     no zone is rejected, never "fixed" by assuming the host offset. This is what
 *     makes "dated" structural rather than a promise in a comment.
 *   - `estimated` may not appear at all. A producer cannot smuggle a derivation in.
 *   - tokens exist only under `measured: true`; otherwise the record contributes
 *     activity and model, and usage stays UNKNOWN — not zero-as-a-value.
 *   - unknown models become `null`. No id is accepted that the reviewed allowlists
 *     do not already contain, and none is added here.
 *   - only receiver-eligible tool ids (`ATTESTED_TOOLS`) are accepted, so no producer
 *     can assert Claude Code or Codex activity by writing a file.
 *   - a tokenless tool's counts are never attributed, whatever the producer claims.
 *   - no message, prompt, body, path or free-form field is read or retained.
 */

export const ATTESTED_RECORD_VERSION = 1;
export const MAX_ATTESTED_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_ATTESTED_CHUNK_BYTES = 1024 * 1024;
/** Records are pure metadata; a line this long is malformed, not a big turn. */
export const MAX_ATTESTED_LINE_BYTES = 64 * 1024;
export const MAX_ATTESTED_RECORDS_PER_POLL = 128;
const MAX_SEEN_DIGESTS = 4096;
const utf8 = new TextDecoder("utf-8", { fatal: true });

interface Cursor {
  dev: bigint;
  ino: bigint;
  offset: number;
  size: number;
  mtime: bigint;
  skipPartial: boolean;
}

const regularFile = (s: fs.BigIntStats): boolean => s.isFile() && !s.isSymbolicLink() &&
  s.nlink === 1n && s.ino > 0n && s.size >= 0n && s.size <= BigInt(MAX_ATTESTED_FILE_BYTES);
/** NTFS is case-insensitive, so a literal compare would reject a legitimate path. */
const samePath = (a: string, b: string): boolean => process.platform === "win32"
  ? a.toLowerCase() === b.toLowerCase() : a === b;

/**
 * Bounded append tailer for exactly one fixed path inside our own state directory.
 * Deliberately separate from `JsonlTailer`: that reader is bound to the two native
 * AI-log layouts and must stay that way. Cursors hold numbers and booleans only —
 * never a raw partial line.
 */
export class AttestedTailer {
  private cursor: Cursor | null = null;

  clear(): void { this.cursor = null; }

  private checked(): fs.BigIntStats | null {
    if (!configDirSafe()) return null;
    try {
      const s = fs.lstatSync(ATTESTED_PATH, { bigint: true });
      if (!regularFile(s)) return null;
      return samePath(fs.realpathSync(ATTESTED_PATH), ATTESTED_PATH) ? s : null;
    } catch { return null; }
  }

  private prime(fd: number, s: fs.BigIntStats): Cursor {
    const size = Number(s.size);
    let skipPartial = false;
    if (size > 0) {
      const last = Buffer.alloc(1);
      skipPartial = fs.readSync(fd, last, 0, 1, size - 1) !== 1 || last[0] !== 10;
    }
    return { dev: s.dev, ino: s.ino, offset: size, size, mtime: s.mtimeNs, skipPartial };
  }

  /** Emits only lines appended since the previous poll. First sight primes at EOF. */
  readNewLines(visit: (record: unknown) => void, signal?: AbortSignal): void {
    if (signal?.aborted) return;
    let fd: number | undefined;
    try {
      const before = this.checked();
      if (!before) { this.cursor = null; return; }
      fd = fs.openSync(ATTESTED_PATH, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
      const s = fs.fstatSync(fd, { bigint: true });
      const after = this.checked();
      if (!regularFile(s) || !after || s.dev !== before.dev || s.ino !== before.ino ||
          s.dev !== after.dev || s.ino !== after.ino || signal?.aborted) { this.cursor = null; return; }
      const size = Number(s.size);
      const cursor = this.cursor;
      // No cursor, replaced file, truncation, a rewrite at the same length, or an
      // append too large to bound: re-prime at EOF and emit nothing. History is
      // never replayed, so a restart cannot re-bill work that was already sent.
      if (!cursor || cursor.dev !== s.dev || cursor.ino !== s.ino || size < cursor.size ||
          (size === cursor.size && s.mtimeNs !== cursor.mtime) || size - cursor.offset > MAX_ATTESTED_CHUNK_BYTES) {
        this.cursor = this.prime(fd, s);
        return;
      }
      if (size <= cursor.offset) return;
      const start = cursor.offset;
      const buffer = Buffer.alloc(size - start);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, start);
      const current = this.checked();
      if (signal?.aborted || !current || current.dev !== s.dev || current.ino !== s.ino) { this.cursor = null; return; }
      cursor.size = size;
      cursor.mtime = s.mtimeNs;
      let lineStart = 0;
      let records = 0;
      while (lineStart < bytes && !signal?.aborted) {
        const end = buffer.indexOf(10, lineStart);
        if (end < 0 || end >= bytes) break;
        if (!cursor.skipPartial && end - lineStart <= MAX_ATTESTED_LINE_BYTES && records++ < MAX_ATTESTED_RECORDS_PER_POLL) {
          try { visit(JSON.parse(utf8.decode(buffer.subarray(lineStart, end)))); }
          catch { /* No error text: a malformed line could quote producer content. */ }
        }
        cursor.skipPartial = false;
        lineStart = end + 1;
      }
      cursor.offset = start + lineStart;
      if (cursor.skipPartial || bytes - lineStart > MAX_ATTESTED_LINE_BYTES) {
        cursor.offset = start + bytes;
        cursor.skipPartial = true;
      }
    } catch { this.cursor = null; }
    finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
  }
}

/**
 * Projects one producer record into an Observation, or `null`. Every branch that is
 * not provably fine returns `null`; nothing is coerced, rounded or inferred.
 */
export function projectAttestedRecord(
  value: unknown, now: number, windowMs: number, tools: readonly string[]
): Observation | null {
  const r = objectRecord(value);
  if (!r || r.v !== ATTESTED_RECORD_VERSION) return null;
  const tool = r.tool;
  if (!isAttestedTool(tool) || !tools.includes(tool)) return null;
  // A derived number may not enter through this door under any spelling.
  if (Object.hasOwn(r, "estimated")) return null;
  if (typeof r.recordId !== "string" || r.recordId.length < 1 || r.recordId.length > 128 ||
      /[^A-Za-z0-9._-]/.test(r.recordId)) return null;
  // The whole point of the receiver: the producer must supply a real instant. A
  // local timestamp without a zone fails here and is never repaired by assuming one.
  const at = eventTime(r.occurredAt, now, windowMs);
  if (at === null) return null;
  const model = safeModel(r.model, tool as SupportedTool);
  const projectHint = r.projectHint === null || r.projectHint === undefined ? null : safeAlias(r.projectHint);
  if (projectHint === null && typeof r.projectHint === "string") return null;

  const hasInput = Object.hasOwn(r, "tokensInputDelta");
  const hasOutput = Object.hasOwn(r, "tokensOutputDelta");
  let tokensInputDelta = 0;
  let tokensOutputDelta = 0;
  const usage: Observation["usage"] = [];
  if (r.measured === true) {
    if (!isCount(r.tokensInputDelta) || !isCount(r.tokensOutputDelta)) return null;
    // Round 4: a tokenless tool has no measured counter in ANY source this project
    // reads, so even a producer's `measured` claim cannot be honoured for it — the
    // record still counts as activity and as a model sighting, and its usage stays
    // unknown. The validation above is kept deliberately: a malformed count is still
    // a rejected record, never a silently ignored one.
    if (!isTokenlessTool(tool)) {
      tokensInputDelta = r.tokensInputDelta;
      tokensOutputDelta = r.tokensOutputDelta;
      if (tokensInputDelta || tokensOutputDelta) usage.push({ model, tokensInputDelta, tokensOutputDelta });
    }
  } else if (r.measured === false || r.measured === undefined) {
    // Unknown usage stays unknown. Counts are not accepted at all without a
    // measured claim, so an absent number can never be read back as a real zero.
    if (hasInput || hasOutput) return null;
  } else return null;

  return { tool, cwd: null, projectHint, model, confidence: "activity",
    lastActivityAt: at, observedAt: at, tokensInputDelta, tokensOutputDelta, usage };
}

/**
 * The opt-in receiver itself. Constructed only when the user switched it on; with an
 * empty tool list it is inert and performs no filesystem operation whatsoever.
 */
export class AttestedMetadataAdapter implements Adapter {
  readonly name = "attested";
  private readonly tailer = new AttestedTailer();
  private seen = new Set<string>();
  private readonly tools: readonly string[];

  constructor(private readonly activeWindowMs: number, tools: readonly string[] = []) {
    this.tools = [...tools].filter(isAttestedTool);
  }

  /** Consent change, account change, pause and cancellation all land here. */
  clear(): void { this.tailer.clear(); this.seen.clear(); }

  async poll(now = Date.now(), signal?: AbortSignal): Promise<Observation[]> {
    if (!this.tools.length || signal?.aborted) return [];
    const observations: Observation[] = [];
    this.tailer.readNewLines((record) => {
      const observation = projectAttestedRecord(record, now, this.activeWindowMs, this.tools);
      if (!observation) return;
      // Replay guard on top of offset tailing: a producer that re-emits a record id
      // (retry, restart, duplicated writer) is counted once per daemon lifetime.
      const digest = createHash("sha256")
        .update(`${observation.tool}\u0000${(record as { recordId: string }).recordId}`).digest("hex");
      if (this.seen.has(digest)) return;
      if (this.seen.size >= MAX_SEEN_DIGESTS) this.seen.delete(this.seen.values().next().value as string);
      this.seen.add(digest);
      observations.push(observation);
    }, signal);
    return signal?.aborted ? [] : observations;
  }
}
