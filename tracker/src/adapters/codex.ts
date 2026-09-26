import { countTime, folderFromCwd, isCount, MAX_EVENT_AGE_MS, MAX_RECORD_AGE_MS, objectRecord, safeModel } from "../privacy";
import { JsonlTailer } from "./jsonlTail";
import type { Adapter, Observation } from "./types";
import { UsageAccumulator } from "./usage";

interface FileMeta {
  generation: number;
  invalidProject: boolean;
  contextModel: string | null;
  contextProject: string | null;
  contextAt: number;
  model: string | null;
  projectHint: string | null;
  input: number | null;
  output: number | null;
  cached: number;
  counterAt: number;
  lastActivityAt: number;
}
const emptyMeta = (generation: number): FileMeta => ({ generation, invalidProject: false, contextModel: null, contextProject: null,
  contextAt: 0, model: null, projectHint: null, input: null, output: null, cached: 0, counterAt: 0, lastActivityAt: 0 });

/**
 * Only documented event_msg/token_count total_token_usage counters qualify.
 * The first counter is a baseline, not a replay of previous account/history use.
 * turn_context supplies optional metadata, NEVER activity by itself. Other
 * session/message/tool records are discarded, not projected or cached.
 */
export class CodexAdapter implements Adapter {
  readonly name = "codex";
  private tailer = new JsonlTailer("codex");
  private fileMeta = new Map<string, FileMeta>();
  constructor(private recentWindowMs: number) {}
  clear(): void { this.tailer.clear(); this.fileMeta.clear(); }

  async poll(now = Date.now(), signal?: AbortSignal): Promise<Observation[]> {
    const files = this.tailer.files(signal);
    const present = new Set(files);
    for (const file of this.fileMeta.keys()) if (!present.has(file)) this.fileMeta.delete(file);
    const out: Observation[] = [];
    for (const file of files) {
      if (signal?.aborted) break;
      let meta = this.fileMeta.get(file);
      const usage = new UsageAccumulator();
      this.tailer.readNewLines(file, (raw, generation) => {
        const line = objectRecord(raw);
        const payload = objectRecord(line?.payload);
        const at = countTime(line?.timestamp, now);
        if (!line || !payload || at === null) return;
        if (line.type === "turn_context") {
          if (!meta || meta.generation !== generation) meta = emptyMeta(generation);
          if (at < meta.contextAt) return;
          const project = folderFromCwd(payload.cwd);
          if (!project || (meta.contextProject !== null && meta.contextProject !== project)) meta.invalidProject = true;
          meta.contextModel = safeModel(payload.model, "codex");
          meta.contextProject = project;
          meta.contextAt = at;
          return;
        }
        if (line.type !== "event_msg" || payload.type !== "token_count") return;
        const info = objectRecord(payload.info);
        const total = objectRecord(info?.total_token_usage);
        if (!total || !isCount(total.input_tokens, 1_000_000_000_000) || !isCount(total.output_tokens, 1_000_000_000_000)) return;
        if (!meta || meta.generation !== generation) meta = emptyMeta(generation);
        if (at < meta.counterAt) return;
        // QA fix (R2): Codex's input_tokens INCLUDES cached_input_tokens. Fresh input is
        // the difference; the cached part rides as cache reads. A malformed or oversized
        // cached count is clamped to input, so it can never make fresh input negative.
        const input = total.input_tokens;
        const output = total.output_tokens;
        const cached = isCount(total.cached_input_tokens, 1_000_000_000_000) ? Math.min(total.cached_input_tokens, input) : 0;
        const baseline = meta.input === null || meta.output === null || input < meta.input || output < meta.output ||
          cached < meta.cached;
        const cacheReadDelta = baseline ? 0 : cached - meta.cached;
        const inputDelta = baseline ? 0 : Math.max(0, input - meta.input! - cacheReadDelta);
        const outputDelta = baseline ? 0 : output - meta.output!;
        meta.input = input; meta.output = output; meta.cached = cached; meta.counterAt = at;
        if (baseline || meta.invalidProject || !(inputDelta || outputDelta || cacheReadDelta)) return;
        // The turn context must be from the same stretch of work as the counter it labels;
        // measured against the counter's own time, so a late-read counter keeps its context.
        const hasContext = meta.contextProject !== null && at - meta.contextAt <= MAX_RECORD_AGE_MS;
        if (!hasContext) return;
        const model = meta.contextModel;
        if (!usage.add(model, inputDelta, outputDelta, false, { cacheRead: cacheReadDelta })) return;
        meta.model = model;
        meta.projectHint = hasContext ? meta.contextProject : null;
        meta.lastActivityAt = Math.max(meta.lastActivityAt, at);
      }, signal);
      if (!meta || meta.generation !== this.tailer.generation(file)) { this.fileMeta.delete(file); continue; }
      this.fileMeta.set(file, meta);
      if (meta.invalidProject || !meta.lastActivityAt) continue;
      // Same rule as Claude Code: stale activity is not presence, its fresh usage counts.
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
