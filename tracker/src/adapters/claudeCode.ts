import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JsonlTailer, RecentIds } from "./jsonlTail";
import type { Adapter, Observation } from "./types";
import { UsageAccumulator, asCount, normalizeModel } from "./usage";

/**
 * Claude Code writes one JSONL per session under ~/.claude/projects/<slug>/<id>.jsonl.
 * Verified format (2026-09): `{"type":"assistant","cwd":"...","timestamp":"ISO",
 * "sessionId":"...","message":{"id":"msg_...","model":"claude-...","usage":{
 * "input_tokens":N,"output_tokens":N,"cache_read_input_tokens":N,
 * "cache_creation_input_tokens":N}}}`. Streaming appends one line per content
 * block with the *same* message.id and repeated usage, hence the id de-dupe.
 *
 * One session file can carry several models: the main model, cheaper side-call
 * models (title generation, sub-agents) and `"<synthetic>"` lines Claude Code
 * fabricates locally (aborts, tool-result stubs — usually zero usage). Each
 * assistant message's tokens are attributed to *that message's* model; synthetic
 * / empty model ids are bucketed under `null` and never become the reported
 * model. `model` is the most recent non-synthetic assistant message with usage.
 * Real ids seen on this machine: claude-opus-5, claude-fable-5-1, claude-sonnet-5,
 * claude-opus-4-8, bare "sonnet"/"opus", "<synthetic>".
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
        // First sighting: the tailer primes at the current end (no replay), so
        // peek at the tail once for the latest cwd + model. Otherwise the first
        // tick reports a slug-guessed alias with model null and the next one
        // "corrects" it — a spurious session_start/session_end pair per start.
        const meta = this.fileMeta.get(file) ?? peekMeta(file);
        const usage = new UsageAccumulator();
        let lastTs = 0;

        for (const raw of this.tailer.readNewLines(file)) {
          const line = raw as ClaudeLine;
          if (line.cwd) meta.cwd = line.cwd;
          const ts = line.timestamp ? Date.parse(line.timestamp) : NaN;
          if (!Number.isNaN(ts)) lastTs = Math.max(lastTs, ts);

          if (line.type !== "assistant" || !line.message) continue;
          const id = line.message.id;
          const u = line.message.usage;
          if (!u || !id) continue;

          // Attribute to this message's own model; "<synthetic>"/"" → null bucket.
          const model = normalizeModel(line.message.model);
          if (model !== null) meta.model = model;

          if (!this.seen.add(id)) continue; // streamed content block of a counted message
          usage.add(
            model,
            asCount(u.input_tokens) + asCount(u.cache_read_input_tokens) + asCount(u.cache_creation_input_tokens),
            asCount(u.output_tokens)
          );
        }
        this.fileMeta.set(file, meta);

        byFile.set(file, {
          tool: this.name,
          cwd: meta.cwd,
          projectHint: meta.cwd ? null : projectFromSlug(root, file),
          model: meta.model,
          // mtime is the freshest signal (user prompts don't carry usage but do touch the file).
          lastActivityAt: Math.max(mtime, lastTs),
          tokensInputDelta: usage.totalInput,
          tokensOutputDelta: usage.totalOutput,
          usage: usage.toList(),
          confidence: "activity",
        });
      }
    }

    return [...byFile.values()];
  }
}

/** How much of a session file's tail to scan on first sighting (a few dozen lines). */
const PEEK_BYTES = 128 * 1024;

/**
 * Reads the last PEEK_BYTES of `file` and returns the latest cwd and the model
 * of the last non-synthetic assistant message with usage. Never counts tokens —
 * that stays the tailer's job. Any I/O or parse problem degrades to nulls.
 */
function peekMeta(file: string): { cwd: string | null; model: string | null } {
  const meta = { cwd: null as string | null, model: null as string | null };
  let fd: number | null = null;
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - PEEK_BYTES);
    const buf = Buffer.alloc(size - start);
    fd = fs.openSync(file, "r");
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // first chunk is almost certainly a partial line
    for (const raw of lines) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      let line: ClaudeLine;
      try {
        line = JSON.parse(trimmed) as ClaudeLine;
      } catch {
        continue;
      }
      if (line.cwd) meta.cwd = line.cwd;
      if (line.type !== "assistant" || !line.message?.usage) continue;
      const model = normalizeModel(line.message.model);
      if (model !== null) meta.model = model;
    }
  } catch {
    /* unreadable / vanished — fall back to the slug hint and a null model */
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  return meta;
}

/** ~/.claude/projects/C--Users-me-code-app/ → "app" (best-effort when no cwd line seen yet). */
function projectFromSlug(root: string, file: string): string | null {
  const rel = path.relative(root, file).split(path.sep)[0];
  if (!rel) return null;
  const parts = rel.split("-").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}
