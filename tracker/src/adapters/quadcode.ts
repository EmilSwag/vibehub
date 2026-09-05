import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JsonlTailer } from "./jsonlTail";
import type { Adapter, Observation } from "./types";
import { UsageAccumulator, normalizeModel } from "./usage";

/**
 * Quadcode AI writes one JSONL per chat section, per project:
 *
 *   <QuadcodeAI root>/apps/<Project>/.quadcodeai/.data/chats/<section>.files/chat_N.jsonl
 *
 * One JSON record per line. Verified against 44 logs / 341 LLM records on a real
 * machine (round 6 plan, Amendment 1):
 *
 *   {"name":"PO","method":"USER","message":"...","timestamp":"2026-09-04T21:18:11.712316",
 *    "images_data":{},"is_status_message":false, ...}
 *   {"name":"Many","method":"LLM","message":"...","variations":[{"model_name":"claude-fable-5-1",
 *    "cluster_node_info":{"id":140068},"meta_info":{}}], "variation_index":0, ...}
 *
 * Three properties of that format drive everything below:
 *
 * 1. **No token counts exist anywhere.** Not in the record, not in `meta_info`
 *    (which holds RAG metadata and a `max_tokens` *boolean*), not in
 *    `cluster_node_info` (just a node id). Tokens here are therefore ESTIMATED
 *    from character counts and flagged `estimated: true` all the way through.
 *
 * 2. **The LLM record's `timestamp` is the turn START, not its end** — it lands
 *    ~40 ms after the user's message, and the line is only appended once the turn
 *    finishes. One observed record spanned 3h47m. So the embedded timestamp is
 *    useless as a liveness signal; the *append* is the signal, and the file mtime
 *    is when that append happened. During a long turn nothing is appended at all —
 *    the process adapter (genui.exe / "Quadcode AI" window) carries presence then,
 *    which is exactly the split the detector is built for.
 *
 * 3. **`message` is ~99% embedded tool transcript.** `message_raw` is byte-identical
 *    to `message`, and in the measured record 214,147 of 215,709 chars sat inside
 *    <TOOL_RUN>/<TOOL_RESULT> blocks. Estimating on the raw message overstates
 *    output by ~138x, so <TOOL_RESULT> blocks (tool output, not model output) are
 *    stripped before counting; prose and <TOOL_RUN> args are kept, because the
 *    model did write those.
 *
 * Media generation is deliberately not model-tagged: `model_name` only ever holds
 * the chat model, and a media call (`ToolGenerateResourceFileFromMetaSection`)
 * names only a meta-section id — the media model lives in a file on disk, not in
 * the log. Quadcode media work is tracked as activity under the chat model.
 *
 * Privacy: only the model id, project, timestamps and character *counts* ever
 * leave this file. Message text is never retained or forwarded.
 */

/** Characters per estimated token — the usual rough rule for English + code. */
const CHARS_PER_TOKEN = 4;

/** A single append bigger than this is skipped (base64 image uploads live inline). */
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
/** A single record longer than this is skipped without parsing. */
const MAX_LINE_CHARS = 2 * 1024 * 1024;

interface QuadcodeLine {
  method?: string;
  message?: string;
  timestamp?: string;
  is_status_message?: boolean;
  variation_index?: number;
  variations?: Array<{ model_name?: string } | null>;
}

interface FileMeta {
  /** Last model seen in this file — also what USER-side input tokens are booked under. */
  model: string | null;
  /** Absolute path whose basename becomes the project alias. */
  projectPath: string;
}

export class QuadcodeAdapter implements Adapter {
  name = "quadcode";
  private tailer = new JsonlTailer({ maxChunkBytes: MAX_CHUNK_BYTES, maxLineChars: MAX_LINE_CHARS });
  private roots: string[];
  private fileMeta = new Map<string, FileMeta>();
  /** projectDir -> resolved project path; git probing is filesystem work, do it once. */
  private projectPaths = new Map<string, string>();

  constructor(private recentWindowMs: number) {
    this.roots = quadcodeRoots();
  }

  async poll(): Promise<Observation[]> {
    const out: Observation[] = [];
    const cutoff = Date.now() - this.recentWindowMs;

    for (const root of this.roots) {
      for (const { file, projectDir } of chatLogs(root)) {
        const mtime = this.tailer.mtime(file);
        if (mtime < cutoff) {
          // Still prime the tailer's offset so a later append is read as a delta
          // rather than replayed from wherever we happened to start.
          this.tailer.readNewLines(file);
          continue;
        }

        const meta =
          this.fileMeta.get(file) ??
          ({ model: peekModel(file), projectPath: this.projectPathFor(projectDir) } satisfies FileMeta);

        const usage = new UsageAccumulator();
        let sawLine = false;

        for (const raw of this.tailer.readNewLines(file)) {
          const line = raw as QuadcodeLine;
          if (line.is_status_message) continue;
          const text = typeof line.message === "string" ? line.message : "";
          if (!text) continue;
          sawLine = true;

          if (line.method === "LLM") {
            const model = modelOf(line);
            if (model !== null) meta.model = model;
            usage.add(model, 0, estimateTokens(stripToolResults(text)), true);
          } else if (line.method === "USER") {
            // The user's own prompt is input to whatever model answers next; the
            // model for that answer is not known yet, so it books under the last
            // model seen in this file (null on a brand-new chat).
            usage.add(meta.model, estimateTokens(text), 0, true);
          }
        }

        this.fileMeta.set(file, meta);

        out.push({
          tool: this.name,
          cwd: meta.projectPath,
          projectHint: null,
          model: meta.model,
          // The append is the activity, and mtime is when it happened (see 2 above).
          lastActivityAt: mtime,
          observedAt: sawLine ? Date.now() : undefined,
          tokensInputDelta: usage.totalInput,
          tokensOutputDelta: usage.totalOutput,
          usage: usage.toList(),
          confidence: "activity",
        });
      }
    }

    return out;
  }

  /**
   * Project alias source, in order (round 6 Amendment 1, deviation 3): the
   * Quadcode project folder if it is itself a git repo; else the nearest
   * enclosing repo; else the single git repo directly inside it — that is the
   * `Vibemunity/vibehub` case, where every other adapter reports `vibehub` from
   * its cwd and Quadcode would otherwise disagree with them about the same work;
   * else the folder itself.
   */
  private projectPathFor(projectDir: string): string {
    const cached = this.projectPaths.get(projectDir);
    if (cached) return cached;

    let resolved = projectDir;
    if (!isGitRepo(projectDir)) {
      const enclosing = nearestEnclosingRepo(projectDir);
      if (enclosing) {
        resolved = enclosing;
      } else {
        const inner = soleInnerRepo(projectDir);
        if (inner) resolved = inner;
      }
    }
    this.projectPaths.set(projectDir, resolved);
    return resolved;
  }
}

/** Roots to search, most specific first. QUADCODE_HOME overrides for tests. */
function quadcodeRoots(): string[] {
  const override = process.env.QUADCODE_HOME;
  if (override) return [override];
  const home = os.homedir();
  const roots: string[] = [];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    roots.push(path.join(appData, "QuadcodeAI"));
  } else if (process.platform === "darwin") {
    roots.push(path.join(home, "Library", "Application Support", "QuadcodeAI"));
  } else {
    roots.push(path.join(home, ".config", "QuadcodeAI"));
  }
  roots.push(path.join(home, ".quadcodeai"));
  return roots;
}

/**
 * Enumerates `<root>/apps/<Project>/.quadcodeai/.data/chats/<section>.files/*.jsonl`.
 * The path shape is fixed, so this walks it directly instead of recursing blindly
 * through a directory that also holds project source trees.
 */
function chatLogs(root: string): Array<{ file: string; projectDir: string }> {
  const out: Array<{ file: string; projectDir: string }> = [];
  const appsDir = path.join(root, "apps");
  for (const project of dirs(appsDir)) {
    const projectDir = path.join(appsDir, project);
    const chatsDir = path.join(projectDir, ".quadcodeai", ".data", "chats");
    for (const section of dirs(chatsDir)) {
      if (!section.endsWith(".files")) continue;
      const sectionDir = path.join(chatsDir, section);
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(sectionDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith(".jsonl")) {
          out.push({ file: path.join(sectionDir, e.name), projectDir });
        }
      }
    }
  }
  return out;
}

function dirs(parent: string): string[] {
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

const isGitRepo = (dir: string): boolean => {
  try {
    return fs.existsSync(path.join(dir, ".git"));
  } catch {
    return false;
  }
};

function nearestEnclosingRepo(from: string): string | null {
  let dir = path.dirname(from);
  for (let i = 0; i < 8; i += 1) {
    if (isGitRepo(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The one git repo directly inside `dir`, or null when there are zero or several. */
function soleInnerRepo(dir: string): string | null {
  const found: string[] = [];
  for (const name of dirs(dir)) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (isGitRepo(full)) found.push(full);
    if (found.length > 1) return null;
  }
  return found.length === 1 ? found[0] : null;
}

/** Tokens estimated from character count — never a measured number. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.round(text.length / CHARS_PER_TOKEN);
}

/**
 * Drops <TOOL_RESULT>…</TOOL_RESULT> spans. Tool *results* are output of the
 * tools, not of the model; <TOOL_RUN> args stay because the model wrote them.
 * Written as a scan rather than a regex so an unterminated block at the end of a
 * truncated message drops cleanly instead of matching to the end of the string.
 */
export function stripToolResults(text: string): string {
  const OPEN = "<TOOL_RESULT>";
  const CLOSE = "</TOOL_RESULT>";
  let out = "";
  let i = 0;
  for (;;) {
    const start = text.indexOf(OPEN, i);
    if (start === -1) {
      out += text.slice(i);
      return out;
    }
    out += text.slice(i, start);
    const end = text.indexOf(CLOSE, start + OPEN.length);
    if (end === -1) return out; // unterminated: everything after is tool output
    i = end + CLOSE.length;
  }
}

/** Model of the variation the record actually used. */
function modelOf(line: QuadcodeLine): string | null {
  const variations = Array.isArray(line.variations) ? line.variations : [];
  if (variations.length === 0) return null;
  const idx =
    typeof line.variation_index === "number" && line.variation_index >= 0 && line.variation_index < variations.length
      ? line.variation_index
      : 0;
  return normalizeModel(variations[idx]?.model_name);
}

/** How much of a log's tail to scan for the last model on first sighting. */
const PEEK_BYTES = 512 * 1024;

/**
 * Last `model_name` value in the tail of `file`, so a chat that is already open
 * when the tracker starts reports its model on the first tick instead of null.
 * Records are large and the read almost always starts mid-record, so this scans
 * the raw text for the field rather than trying to parse partial JSON.
 */
function peekModel(file: string): string | null {
  let fd: number | null = null;
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - PEEK_BYTES);
    const buf = Buffer.alloc(size - start);
    fd = fs.openSync(file, "r");
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    const KEY = '"model_name":';
    const at = text.lastIndexOf(KEY);
    if (at === -1) return null;
    const openQuote = text.indexOf('"', at + KEY.length);
    if (openQuote === -1) return null;
    const closeQuote = text.indexOf('"', openQuote + 1);
    if (closeQuote === -1) return null;
    return normalizeModel(text.slice(openQuote + 1, closeQuote));
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}
