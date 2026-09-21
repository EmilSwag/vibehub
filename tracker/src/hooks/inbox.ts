import * as fs from "node:fs";
import { MAX_ATTESTED_FILE_BYTES, MAX_ATTESTED_LINE_BYTES } from "../adapters/attested";
import { attestedToolsFor, readConfig } from "../config";
import { ATTESTED_PATH, ensureConfigDir } from "../paths";
import { isHookableTool, projectHookEvent } from "./payload";
import type { AttestedHookRecord } from "./payload";

/**
 * Writing side of the opt-in inbox. This runs ONLY in the short-lived `hook` process —
 * never in the daemon, which treats `~/.vibehub/attested.jsonl` as read-only and would
 * fail its own privacy harness if it ever opened the file for writing. That separation is
 * the point of the design and is asserted statically by `scripts/check-ai-only.mjs`.
 *
 * Everything here is bounded and silent:
 *   - one line per event, capped well below the receiver's own line bound;
 *   - the file is opened append-only, refusing symlinks, and its inode is re-checked
 *     after opening, so a swapped path cannot redirect the write;
 *   - the inbox is truncated when it grows past a bound, because a file larger than the
 *     receiver's limit would silently stop being read. Truncation loses only history the
 *     receiver has already consumed: it re-primes at EOF and never replays;
 *   - nothing is ever read back out of the file, printed, or logged. A hook that talks
 *     would leak into the IDE's own output, and a hook that throws would surface as a
 *     failure inside the user's editor. Neither is acceptable for telemetry.
 */

/** Past this size the inbox is restarted, far below the receiver's 32 MiB refusal bound. */
export const INBOX_ROTATE_AT_BYTES = Math.min(8 * 1024 * 1024, MAX_ATTESTED_FILE_BYTES);
/** A record is five or six short metadata fields; anything longer is malformed, not verbose. */
export const MAX_HOOK_RECORD_BYTES = Math.min(2048, MAX_ATTESTED_LINE_BYTES);
/** Hook payloads carry prompts and whole responses; we parse a bounded prefix or nothing. */
export const MAX_HOOK_STDIN_BYTES = 256 * 1024;
/**
 * Deadline for the whole stdin read. An IDE may hand a hook a pipe it never closes — an
 * inherited stdin, a wrapper that stays open for the session — and waiting for EOF would
 * leave this process alive inside the user's editor forever. It finishes on the first
 * complete JSON value instead, and this is only the backstop.
 */
export const HOOK_STDIN_TIMEOUT_MS = 2000;

/**
 * Appends one record. Returns false instead of throwing on every failure path — a hook
 * must not break the editor that spawned it.
 */
export function appendAttestedRecord(record: AttestedHookRecord): boolean {
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch { return false; }
  // JSON.stringify escapes control characters, so a newline cannot split one record into
  // two. Asserted rather than assumed: the file format is one record per line.
  if (!line || line.includes("\n") || Buffer.byteLength(line) > MAX_HOOK_RECORD_BYTES) return false;

  let fd: number | undefined;
  try {
    ensureConfigDir();
    try {
      const existing = fs.lstatSync(ATTESTED_PATH);
      if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) return false;
      if (existing.size >= INBOX_ROTATE_AT_BYTES) fs.truncateSync(ATTESTED_PATH, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }
    fd = fs.openSync(ATTESTED_PATH,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW ?? 0),
      0o600);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1) return false;
    fs.writeSync(fd, `${line}\n`);
    return true;
  } catch { return false; }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
}

/**
 * Bounded, deadline-guarded stdin read that returns the parsed payload, or null.
 *
 * Three ways it can finish, and no fourth:
 *   - the accumulated bytes parse as JSON — the normal case, and it returns immediately
 *     rather than waiting for EOF, so a pipe the IDE leaves open costs nothing;
 *   - the stream ends, or the deadline passes: one last parse attempt, then give up;
 *   - more than `MAX_HOOK_STDIN_BYTES` arrive: abandoned outright. A prompt or a whole
 *     Cascade response can be megabytes, and half a JSON document is not a payload.
 *
 * The stream is detached and destroyed on every path, so nothing keeps the process alive.
 * Nothing read here is ever echoed: a parse failure is silent because the text that failed
 * could be the user's prompt.
 */
function readBoundedPayload(stream: NodeJS.ReadableStream, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const parsed = (): unknown => {
      if (!chunks.length) return null;
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        return text.trim() ? JSON.parse(text) : null;
      } catch { return null; }
    };
    const finish = (value: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onEnd);
      try { (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.(); } catch { /* already gone */ }
      resolve(value);
    };
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += buffer.length;
      if (total > MAX_HOOK_STDIN_BYTES) { finish(null); return; }
      chunks.push(buffer);
      const value = parsed();
      if (value !== null) finish(value);
    };
    const onEnd = (): void => finish(parsed());
    const timer = setTimeout(() => finish(parsed()), timeoutMs);
    timer.unref?.();
    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onEnd);
  });
}

/**
 * The whole `vibehub-tracker hook <tool>` command.
 *
 * Consent is re-checked here, not only at install time: if the user removed the tool from
 * `attestedMetadata` but left the vendor's hook in place, this writes nothing. The inbox
 * then stays exactly as consent says it should, rather than filling up with records the
 * daemon has been told to ignore.
 *
 * It resolves `true`/`false` for tests. The CLI ignores the value and always exits 0.
 */
export async function runHookEvent(
  tool: unknown, stream: NodeJS.ReadableStream, now = Date.now(), timeoutMs = HOOK_STDIN_TIMEOUT_MS
): Promise<boolean> {
  try {
    // Both gates run BEFORE stdin is touched: an unlisted tool or a withdrawn consent
    // means the payload is not read at all, not read and then discarded.
    if (!isHookableTool(tool)) return false;
    const config = readConfig();
    if (!config || !attestedToolsFor(config).includes(tool)) return false;
    const payload = await readBoundedPayload(stream, timeoutMs);
    if (payload === null) return false;
    const record = projectHookEvent(tool, payload, now);
    return record === null ? false : appendAttestedRecord(record);
  } catch { return false; }
}
