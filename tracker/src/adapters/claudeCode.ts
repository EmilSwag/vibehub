import { createHash } from "node:crypto";
import { countTime, folderFromCwd, isCount, MAX_EVENT_AGE_MS, objectRecord, safeModel } from "../privacy";
import { JsonlTailer } from "./jsonlTail";
import type { Adapter, Observation } from "./types";
import { UsageAccumulator } from "./usage";

interface FileMeta { generation: number; projectHint: string | null; model: string | null; lastActivityAt: number; invalidProject: boolean }
interface Receipt { input: number; output: number; cacheRead: number; cacheWrite: number; model: string | null; at: number; seenAt: number }

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
  constructor(private recentWindowMs: number) {}

  clear(): void { this.tailer.clear(); this.fileMeta.clear(); this.receipts.clear(); }

  async poll(now = Date.now(), signal?: AbortSignal): Promise<Observation[]> {
    const files = this.tailer.files(signal);
    const present = new Set(files);
    for (const file of this.fileMeta.keys()) if (!present.has(file)) this.fileMeta.delete(file);
    // Expire by when a receipt was SEEN, not by its record time: a late record (see
    // countTime) must still de-duplicate the repeat lines of its message next poll.
    for (const [id, receipt] of this.receipts) if (now - receipt.seenAt > MAX_EVENT_AGE_MS) this.receipts.delete(id);
    const out: Observation[] = [];
    for (const file of files) {
      if (signal?.aborted) break;
      let meta = this.fileMeta.get(file);
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
        const projectHint = folderFromCwd(line.cwd);
        if (!projectHint) return;
        if (meta?.generation === generation && meta.projectHint !== projectHint) meta.invalidProject = true;
        if (meta?.generation === generation && meta.invalidProject) return;
        const model = safeModel(message.model, "claude-code");
        // A digest, never even the raw message ID, survives for de-duplication.
        const id = createHash("sha256").update(message.id).digest("hex");
        const previous = this.receipts.get(id);
        if (previous && (previous.model !== model || at < previous.at || input < previous.input || output < previous.output ||
            cacheRead < previous.cacheRead || cacheWrite < previous.cacheWrite)) return;
        const inputDelta = input - (previous?.input ?? 0);
        const outputDelta = output - (previous?.output ?? 0);
        const cacheReadDelta = cacheRead - (previous?.cacheRead ?? 0);
        const cacheWriteDelta = cacheWrite - (previous?.cacheWrite ?? 0);
        if (!(inputDelta || outputDelta || cacheReadDelta) ||
            !usage.add(model, inputDelta, outputDelta, false, { cacheRead: cacheReadDelta, cacheWrite: cacheWriteDelta })) return;
        this.receipts.set(id, { input, output, cacheRead, cacheWrite, model, at, seenAt: now });
        while (this.receipts.size > 2048) this.receipts.delete(this.receipts.keys().next().value!);
        if (!meta || meta.generation !== generation) meta = { generation, projectHint, model: null, lastActivityAt: 0, invalidProject: false };
        meta.projectHint = folderFromCwd(line.cwd);
        meta.model = model;
        meta.lastActivityAt = Math.max(meta.lastActivityAt, at);
      }, signal);
      if (!meta || meta.generation !== this.tailer.generation(file)) { this.fileMeta.delete(file); continue; }
      this.fileMeta.set(file, meta);
      if (meta.invalidProject) continue;
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
