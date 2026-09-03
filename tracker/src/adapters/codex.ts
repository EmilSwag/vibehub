import os from "node:os";
import path from "node:path";
import { JsonlTailer } from "./jsonlTail";
import type { Adapter, Observation } from "./types";

/**
 * OpenAI Codex CLI rollouts: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 * (CODEX_HOME overrides ~/.codex). Lines we care about:
 *   {"type":"session_meta","payload":{"cwd":"..."}}
 *   {"type":"turn_context","payload":{"cwd":"...","model":"gpt-5-codex"}}
 *   {"type":"event_msg","payload":{"type":"token_count","info":{
 *       "total_token_usage":{"input_tokens","cached_input_tokens","output_tokens"},
 *       "last_token_usage":{...}}}}
 * token_count carries running totals, so we diff against the last total per file.
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
      let input = 0;
      let output = 0;
      let lastTs = 0;

      for (const raw of this.tailer.readNewLines(file)) {
        const line = raw as CodexLine;
        const ts = line.timestamp ? Date.parse(line.timestamp) : NaN;
        if (!Number.isNaN(ts)) lastTs = Math.max(lastTs, ts);
        const p = line.payload;
        if (!p) continue;
        if (p.cwd) meta.cwd = p.cwd;
        if (p.model) meta.model = p.model;

        if (line.type === "event_msg" && p.type === "token_count" && p.info) {
          const total = p.info.total_token_usage;
          if (total) {
            const tin = (total.input_tokens ?? 0) + (total.cached_input_tokens ?? 0);
            const tout = total.output_tokens ?? 0;
            if (meta.totalIn >= 0) {
              input += Math.max(0, tin - meta.totalIn);
              output += Math.max(0, tout - meta.totalOut);
            } else if (p.info.last_token_usage) {
              // First total we see for this file: count only the latest turn.
              const last = p.info.last_token_usage;
              input += (last.input_tokens ?? 0) + (last.cached_input_tokens ?? 0);
              output += last.output_tokens ?? 0;
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
        tokensInputDelta: input,
        tokensOutputDelta: output,
        confidence: "activity",
      });
    }

    return out;
  }
}
