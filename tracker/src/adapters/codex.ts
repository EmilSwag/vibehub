import os from "node:os";
import path from "node:path";
import { JsonlTailer } from "./jsonlTail";
import type { Adapter, Observation } from "./types";
import { UsageAccumulator, asCount, normalizeModel } from "./usage";

/**
 * OpenAI Codex CLI rollouts: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 * (CODEX_HOME overrides ~/.codex). Lines we care about:
 *   {"type":"session_meta","payload":{"cwd":"..."}}
 *   {"type":"turn_context","payload":{"cwd":"...","model":"gpt-5-codex"}}
 *   {"type":"event_msg","payload":{"type":"token_count","info":{
 *       "total_token_usage":{"input_tokens","cached_input_tokens","output_tokens"},
 *       "last_token_usage":{...}}}}
 * token_count carries running totals, so we diff against the last total per file.
 * Each delta is attributed to the model named by the latest `turn_context`
 * (null until one has been seen), so a mid-session model switch is booked correctly.
 */
interface CodexLine {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    cwd?: string;
    model?: string;
    info?: {
      total_token_usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
      last_token_usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
    };
  };
}

export class CodexAdapter implements Adapter {
  name = "codex";
  private tailer = new JsonlTailer();
  private root: string;
  private fileMeta = new Map<string, { cwd: string | null; model: string | null; totalIn: number; totalOut: number }>();

  constructor(private recentWindowMs: number) {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    this.root = path.join(home, "sessions");
  }

  async poll(): Promise<Observation[]> {
    const out: Observation[] = [];

    for (const file of this.tailer.recentFiles(this.root, this.recentWindowMs)) {
      const meta = this.fileMeta.get(file) ?? { cwd: null, model: null, totalIn: -1, totalOut: -1 };
      const usage = new UsageAccumulator();
      let lastTs = 0;

      for (const raw of this.tailer.readNewLines(file)) {
        const line = raw as CodexLine;
        const ts = line.timestamp ? Date.parse(line.timestamp) : NaN;
        if (!Number.isNaN(ts)) lastTs = Math.max(lastTs, ts);
        const p = line.payload;
        if (!p) continue;
        if (p.cwd) meta.cwd = p.cwd;
        const model = normalizeModel(p.model);
        if (model !== null) meta.model = model;

        if (line.type === "event_msg" && p.type === "token_count" && p.info) {
          const total = p.info.total_token_usage;
          if (total) {
            const tin = asCount(total.input_tokens) + asCount(total.cached_input_tokens);
            const tout = asCount(total.output_tokens);
            if (meta.totalIn >= 0) {
              usage.add(meta.model, Math.max(0, tin - meta.totalIn), Math.max(0, tout - meta.totalOut));
            } else if (p.info.last_token_usage) {
              // First total we see for this file: count only the latest turn.
              const last = p.info.last_token_usage;
              usage.add(
                meta.model,
                asCount(last.input_tokens) + asCount(last.cached_input_tokens),
                asCount(last.output_tokens)
              );
            }
            meta.totalIn = tin;
            meta.totalOut = tout;
          }
        }
      }
      this.fileMeta.set(file, meta);

      out.push({
        tool: this.name,
        cwd: meta.cwd,
        projectHint: null,
        model: meta.model,
        lastActivityAt: Math.max(this.tailer.mtime(file), lastTs),
        tokensInputDelta: usage.totalInput,
        tokensOutputDelta: usage.totalOutput,
        usage: usage.toList(),
        confidence: "activity",
      });
    }

    return out;
  }
}
