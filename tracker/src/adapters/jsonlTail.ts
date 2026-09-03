import fs from "node:fs";
import path from "node:path";

/**
 * Incremental JSONL reader shared by the Claude Code and Codex adapters.
 *
 * - `recentFiles(root, maxAgeMs)` walks `root` (2 levels deep) and returns *.jsonl
 *   files modified within the window — that's all we ever need to tail.
 * - `readNewLines(file)` returns parsed lines appended since the previous call.
 *   The first time a file is seen we start from its current end, so an old
 *   multi-megabyte session doesn't get replayed (and double-counted) on startup.
 */
export class JsonlTailer {
  private offsets = new Map<string, number>();
  private partial = new Map<string, string>();

  recentFiles(root: string, maxAgeMs: number): string[] {
    const out: string[] = [];
    if (!fs.existsSync(root)) return out;
    const cutoff = Date.now() - maxAgeMs;

    const visit = (dir: string, depth: number) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (depth < 4) visit(full, depth + 1);
        } else if (e.isFile() && e.name.endsWith(".jsonl")) {
          try {
            if (fs.statSync(full).mtimeMs >= cutoff) out.push(full);
          } catch {
            /* vanished between readdir and stat */
          }
        }
      }
    };
    visit(root, 0);
    return out;
  }

  readNewLines(file: string): unknown[] {
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      return [];
    }

    const known = this.offsets.get(file);
    if (known === undefined) {
      // First sighting: don't replay history, just remember where the end is.
      this.offsets.set(file, size);
      return [];
    }
    if (size < known) {
      // Truncated/rotated — start over from the beginning.
      this.offsets.set(file, 0);
      this.partial.delete(file);
      return this.readNewLines(file);
    }
    if (size === known) return [];

    const length = size - known;
    const buf = Buffer.alloc(length);
    let fd: number | null = null;
    try {
      fd = fs.openSync(file, "r");
      fs.readSync(fd, buf, 0, length, known);
    } catch {
      return [];
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
    this.offsets.set(file, size);

    const text = (this.partial.get(file) ?? "") + buf.toString("utf8");
    const lines = text.split("\n");
    // Last chunk may be an unfinished line — keep it for the next poll.
    this.partial.set(file, lines.pop() ?? "");

    const parsed: unknown[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        parsed.push(JSON.parse(trimmed));
      } catch {
        /* skip malformed line */
      }
    }
    return parsed;
  }

  mtime(file: string): number {
    try {
      return fs.statSync(file).mtimeMs;
    } catch {
      return 0;
    }
  }
}

/** Bounded set of recently-seen ids (Claude Code writes one line per content block; same message.id). */
export class RecentIds {
  private ids = new Set<string>();
  private order: string[] = [];
  constructor(private max = 2000) {}

  /** Returns true if the id was new. */
  add(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    this.order.push(id);
    if (this.order.length > this.max) {
      const oldest = this.order.shift();
      if (oldest) this.ids.delete(oldest);
    }
    return true;
  }
}
