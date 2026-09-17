import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";

export const CONFIG_DIR = path.join(os.homedir(), ".vibehub");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const STATUS_PATH = path.join(CONFIG_DIR, "status.json");
/** Legacy file is deliberately not opened, replayed, rewritten or deleted. */
export const QUEUE_PATH = path.join(CONFIG_DIR, "queue.json");
export const PID_PATH = path.join(CONFIG_DIR, "tracker.pid");
export const LOG_PATH = path.join(CONFIG_DIR, "daemon.log");
export const STOP_REQUEST_PATH = path.join(CONFIG_DIR, "stop.request");
const JSON_PATHS = new Set([CONFIG_PATH, STATUS_PATH, PID_PATH, STOP_REQUEST_PATH]);
const MAX_STATE_BYTES = 64 * 1024;
const normalized = (p: string): string => process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p);

function safeDirectory(): boolean {
  try {
    const s = fs.lstatSync(CONFIG_DIR);
    return s.isDirectory() && !s.isSymbolicLink() && normalized(fs.realpathSync(CONFIG_DIR)) === normalized(CONFIG_DIR);
  } catch { return false; }
}
export function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (!safeDirectory()) throw new Error("Tracker state directory is unavailable.");
  try { fs.chmodSync(CONFIG_DIR, 0o700); } catch { /* POSIX modes are best-effort on Windows. */ }
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  if (!JSON_PATHS.has(filePath)) throw new Error("Unsupported tracker state file.");
  const raw = JSON.stringify(data, null, 2);
  if (Buffer.byteLength(raw) > MAX_STATE_BYTES) throw new Error("Tracker state exceeds its bound.");
  ensureConfigDir();
  try {
    const s = fs.lstatSync(filePath);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw new Error("Tracker state file is unavailable.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const temporary = path.join(CONFIG_DIR, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, raw, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, filePath);
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}

export function removeFile(filePath: string): void {
  if (!JSON_PATHS.has(filePath) || !safeDirectory()) return;
  try { fs.unlinkSync(filePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

/** Bounded reads of our own protocol files only; never the legacy offline queue. */
export function readJson<T>(filePath: string): T | null {
  let fd: number | undefined;
  try {
    if (!JSON_PATHS.has(filePath) || !safeDirectory()) return null;
    const before = fs.lstatSync(filePath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_STATE_BYTES) return null;
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size > MAX_STATE_BYTES || !safeDirectory()) return null;
    const buffer = Buffer.alloc(opened.size + 1);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (bytes !== opened.size) return null;
    return JSON.parse(buffer.subarray(0, bytes).toString("utf8")) as T;
  } catch { return null; }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
}
