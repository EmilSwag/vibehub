import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

export const CONFIG_DIR = path.join(os.homedir(), ".vibehub");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const STATUS_PATH = path.join(CONFIG_DIR, "status.json");
export const QUEUE_PATH = path.join(CONFIG_DIR, "queue.json");
export const PID_PATH = path.join(CONFIG_DIR, "tracker.pid");
export const LOG_PATH = path.join(CONFIG_DIR, "daemon.log");
/** Written by `stop`, watched by the daemon — see stopRequest.ts. */
export const STOP_REQUEST_PATH = path.join(CONFIG_DIR, "stop.request");

/**
 * Ensures ~/.vibehub exists with 0700 permissions. chmod is a no-op on Windows
 * (no POSIX permission bits) so this degrades silently there — see tracker/README.md.
 */
export function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(CONFIG_DIR, 0o700);
  } catch {
    // best-effort — Windows filesystems don't support POSIX mode bits
  }
}

/**
 * Atomically writes JSON to `filePath`: write to a temp file in the same
 * directory, then rename() — so a concurrent reader (e.g. vibehub/macos) never
 * observes a half-written file. Sets 0600 on the final file (best-effort).
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureConfigDir();
  const dir = path.dirname(filePath);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort — Windows filesystems don't support POSIX mode bits
  }
}

export function removeFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err: any) {
    if (err && err.code !== "ENOENT") throw err;
  }
}

export function readJson<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err && err.code === "ENOENT") return null;
    return null;
  }
}
