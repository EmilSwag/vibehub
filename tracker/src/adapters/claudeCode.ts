import os from "node:os";
import path from "node:path";
import { JsonlTailer, RecentIds } from "./jsonlTail";
import type { Adapter, Observation } from "./types";

/**
 * Claude Code writes one JSONL per session under ~/.claude/projects/<slug>/<id>.jsonl.
 * Verified format (2026-09): `{"type":"assistant","cwd":"...","timestamp":"ISO",
 * "sessionId":"...","message":{"id":"msg_...","model":"claude-...","usage":{
 * "input_tokens":N,"output_tokens":N,"cache_read_input_tokens":N,
 * "cache_creation_input_tokens":N}}}`. Streaming appends one line per content
 * block with the *same* message.id and repeated usage, hence the id de-dupe.
 *
 * Also honours CLAUDE_CONFIG_DIR (Claude Code's own override).
 */
interface ClaudeLine {
  type?: string;
  cwd?: string;
  timestamp?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

export class ClaudeCodeAdapter implements Adapter {
  name = "claude-code";
  private tailer = new JsonlTailer();
  private seen = new RecentIds();
  private roots: string[];
  /** Last known cwd/model per file, so activity without usage still resolves a project. */
  private fileMeta = new Map<string, { cwd: string | null; model: string | null }>();

  constructor(private recentWindowMs: number) {
    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
    this.roots = [path.join(configDir, "projects")];
  }

  async poll(): Promise<Observation[]> {
    const byFile = new Map<string, Observation>();

    for (const root of this.roots) {
      for (const file of this.tailer.recentFiles(root, this.recentWindowMs)) {
        const mtime = this.tailer.mtime(file);
        const meta = this.fileMeta.get(file) ?? { cwd: null, model: null };
        let input = 0;
        let output = 0;
        let lastTs = 0;

        for (const raw of this.tailer.readNewLines(file)) {
          const line = raw as ClaudeLine;
          if (line.cwd) meta.cwd = line.cwd;
          const ts = line.timestamp ? Date.parse(line.timestamp) : NaN;
          if (!Number.isNaN(ts)) lastTs = Math.max(lastTs, ts);

          if (line.type !== "assistant" || !line.message) continue;
          if (line.message.model) meta.model = line.message.model;

          const id = line.message.id;
          const usage = line.message.usage;
          if (!usage || !id || !this.seen.add(id)) continue;

          input +=
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0);
          output += usage.output_tokens ?? 0;
        }
        this.fileMeta.set(file, meta);

        byFile.set(file, {
          tool: this.name,
          cwd: meta.cwd,
          projectHint: meta.cwd ? null : projectFromSlug(root, file),
          model: meta.model,
          // mtime is the freshest signal (user prompts don't carry usage but do touch the file).
          lastActivityAt: Math.max(mtime, lastTs),
          tokensInputDelta: input,
          tokensOutputDelta: output,
          confidence: "activity",
        });
      }
    }

    return [...byFile.values()];
  }
}

/** ~/.claude/projects/C--Users-me-code-app/ → "app" (best-effort when no cwd line seen yet). */
function projectFromSlug(root: string, file: string): string | null {
  const rel = path.relative(root, file).split(path.sep)[0];
  if (!rel) return null;
  const parts = rel.split("-").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}
