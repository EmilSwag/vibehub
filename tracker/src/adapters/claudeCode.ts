import { createHash } from "node:crypto";
import { countTime, folderFromCwd, isCount, MAX_EVENT_AGE_MS, objectRecord, safeModel } from "../privacy";
import { JsonlTailer } from "./jsonlTail";
import type { Adapter, Observation } from "./types";
import { UsageAccumulator } from "./usage";

interface FileMeta { generation: number; projectHint: string | null; model: string | null; lastActivityAt: number }
interface Receipt { input: number; output: number; cacheRead: number; cacheWrite: number; model: string | null; at: number }

/**
 * L1 follow-up (U1): de-duplication receipts are a bounded LRU keyed by a digest of
 * message.id + requestId, with NO time expiry. A file can now be read from byte 0 (it
 * appeared, or re-entered the listing, since the last poll), and a subagent transcript
 * can repeat what its session already logged; either must count each turn once. Only
 * a 128-bit digest and counters are kept - never an id, a request id or a body.
 */
export const MAX_RECEIPTS = 16_384;
/** Remembered project folder hint per encoded project directory, for subagent attribution. */
const MAX_PROJECT_HINTS = 512;
const REQUEST_ID = /^req_[A-Za-z0-9_-]{1,120}$/;

/**
 * Claude Code names a project directory after the session's LAUNCH folder with every
 * non-alphanumeric character replaced by "-" (/Users/me/my.app -> -Users-me-my-app).
 */
export function projectSlug(folder: string): string { return folder.replace(/[^A-Za-z0-9]/g, "-"); }

/**
 * L1 P0: the session's project is its LAUNCH folder, not whatever `cwd` a line reports.
 * A session that `cd`s into a subfolder (or anywhere else) used to flip the per-line
 * folder, mark the whole file invalid and drop every later token and its presence.
 * Walk `cwd` up, prefix by prefix, to the one whose slug IS the project directory's
 * name, and use that folder's name. String-only: nothing is stat'ed or opened. null
 * when no prefix matches (a cwd outside the launch folder, or a slug Claude Code
 * shortened) - the caller then keeps what it already knows.
 */
export function launchFolder(cwd: unknown, projectDir: string | null): string | null {
  if (typeof cwd !== "string" || !projectDir || cwd.length > 1024 || /[\x00-\x1f\x7f]/.test(cwd)) return null;
  let prefix = cwd.replace(/[\\/]+$/, "");
  for (let depth = 0; prefix && depth < 64; depth++) {
    if (projectSlug(prefix) === projectDir) return folderFromCwd(prefix);
    const cut = Math.max(prefix.lastIndexOf("/"), prefix.lastIndexOf("\\"));
    if (cut <= 0) break;
    prefix = prefix.slice(0, cut);
  }
  return null;
}

/**
 * Only `type:assistant`, `message.role:assistant`, message ID, real usage numbers
 * and a fresh record timestamp qualify. No history/model peeks, user messages,
 * progress/tool records or file timestamps count as AI activity. Full JSONL may
 * be parsed transiently by JsonlTailer; bodies are never copied into this state.
 */
export class ClaudeCodeAdapter implements Adapter {
  readonly name = "claude-code";
  private tailer = new JsonlTailer("claude-code");
  private fileMeta = new Map<string, FileMeta>();
  private receipts = new Map<string, Receipt>();
  private projectHints = new Map<string, string>();
  constructor(private recentWindowMs: number) {}

  clear(): void { this.tailer.clear(); this.fileMeta.clear(); this.receipts.clear(); this.projectHints.clear(); }

  private rememberHint(projectDir: string | null, hint: string): void {
    if (!projectDir) return;
    this.projectHints.delete(projectDir);
    this.projectHints.set(projectDir, hint);
    while (this.projectHints.size > MAX_PROJECT_HINTS) this.projectHints.delete(this.projectHints.keys().next().value!);
  }

  async poll(now = Date.now(), signal?: AbortSignal): Promise<Observation[]> {
    const files = this.tailer.files(signal);
    const present = new Set(files);
    for (const file of this.fileMeta.keys()) if (!present.has(file)) this.fileMeta.delete(file);
    const out: Observation[] = [];
    // Session files first, so a subagent read in the same poll can inherit its parent's
    // project from the lines just read.
    const ordered = [...files].sort((a, b) => Number(this.tailer.subagentParent(a) !== null) - Number(this.tailer.subagentParent(b) !== null));
    for (const file of ordered) {
      if (signal?.aborted) break;
      let meta = this.fileMeta.get(file);
      const parent = this.tailer.subagentParent(file);
      const projectDir = this.tailer.projectDir(file);
      const usage = new UsageAccumulator();
      this.tailer.readNewLines(file, (raw, generation) => {
        const line = objectRecord(raw);
        if (!line || line.type !== "assistant") return;
        const message = objectRecord(line.message);
        const counts = objectRecord(message?.usage);
        const at = countTime(line.timestamp, now);
        if (!message || message.role !== "assistant" || !counts || at === null ||
            typeof message.id !== "string" || message.id.length > 128 ||
            !/^msg_[A-Za-z0-9_-]+$/.test(message.id) || /\s/.test(message.id) || message.model === "<synthetic>") return;
        if (!isCount(counts.input_tokens) || !isCount(counts.output_tokens) ||
            !isCount(counts.cache_read_input_tokens ?? 0) || !isCount(counts.cache_creation_input_tokens ?? 0)) return;
        // QA fix (R2): cache reads are re-used context, not new work - folding them into
        // input made a Claude Code day read ~40x too many "tokens". Fresh input is the
        // uncached prompt plus what was written to the cache (billed input); reads ride
        // separately. cache_creation is kept as its own counter only for pricing.
        const cacheWrite = (counts.cache_creation_input_tokens as number | undefined) ?? 0;
        const cacheRead = (counts.cache_read_input_tokens as number | undefined) ?? 0;
        const input = counts.input_tokens + cacheWrite;
        const output = counts.output_tokens;
        if (!isCount(input)) return;
        // Project = the session's launch folder (launchFolder). No match: keep what is
        // already known - this file's hint, the parent session's (a subagent's work
        // belongs to its parent's project, even from a worktree), the project
        // directory's - and only then the line's own folder. A change of cwd mid-session
        // never invalidates the file: its tokens and presence keep counting.
        const dir = parent?.projectDir ?? projectDir;
        const known = (meta?.generation === generation ? meta.projectHint : null) ??
          (parent ? this.fileMeta.get(parent.sessionFile)?.projectHint : null) ??
          (dir ? this.projectHints.get(dir) : undefined) ?? null;
        const projectHint = launchFolder(line.cwd, dir) ?? known ?? folderFromCwd(line.cwd);
        if (!projectHint) return;
        const model = safeModel(message.model, "claude-code");
        // A digest, never even the raw message ID, survives for de-duplication.
        const requestId = typeof line.requestId === "string" && REQUEST_ID.test(line.requestId) ? line.requestId : "";
        const id = createHash("sha256").update(`${message.id}\u0000${requestId}`).digest("hex").slice(0, 32);
        const previous = this.receipts.get(id);
        if (previous) { this.receipts.delete(id); this.receipts.set(id, previous); }
        if (previous && (previous.model !== model || at < previous.at || input < previous.input || output < previous.output ||
            cacheRead < previous.cacheRead || cacheWrite < previous.cacheWrite)) return;
        const inputDelta = input - (previous?.input ?? 0);
        const outputDelta = output - (previous?.output ?? 0);
        const cacheReadDelta = cacheRead - (previous?.cacheRead ?? 0);
        const cacheWriteDelta = cacheWrite - (previous?.cacheWrite ?? 0);
        if (!(inputDelta || outputDelta || cacheReadDelta) ||
            !usage.add(model, inputDelta, outputDelta, false, { cacheRead: cacheReadDelta, cacheWrite: cacheWriteDelta })) return;
        // LRU: every hit re-inserts (above), so the least recently seen turn goes first.
        this.receipts.set(id, { input, output, cacheRead, cacheWrite, model, at });
        while (this.receipts.size > MAX_RECEIPTS) this.receipts.delete(this.receipts.keys().next().value!);
        if (!meta || meta.generation !== generation) meta = { generation, projectHint, model: null, lastActivityAt: 0 };
        meta.projectHint = projectHint;
        if (!parent) this.rememberHint(projectDir, projectHint);
        meta.model = model;
        meta.lastActivityAt = Math.max(meta.lastActivityAt, at);
      }, signal);
      if (!meta || meta.generation !== this.tailer.generation(file)) { this.fileMeta.delete(file); continue; }
      this.fileMeta.set(file, meta);
      // Stale activity is not presence. Its freshly READ usage still counts (QA fix R3),
      // flagged `late` so the detector books the tokens without claiming activity.
      const late = now - meta.lastActivityAt > Math.min(this.recentWindowMs, MAX_EVENT_AGE_MS);
      const list = usage.toList();
      if (late && !list.length) continue;
      out.push({ tool: this.name, cwd: null, projectHint: meta.projectHint, model: meta.model,
        lastActivityAt: meta.lastActivityAt, observedAt: meta.lastActivityAt,
        tokensInputDelta: usage.totalInput, tokensOutputDelta: usage.totalOutput,
        usage: list, confidence: "activity", ...(late ? { late: true } : {}) });
    }
    return signal?.aborted ? [] : out;
  }
}
