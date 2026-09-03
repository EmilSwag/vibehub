import { QUEUE_PATH, readJson, writeJsonAtomic } from "./paths";
import type { QueuedEvent } from "./types";

/** Hard cap so a long offline stretch can't grow the queue file without bound. */
const MAX_QUEUE_LENGTH = 500;

function readQueue(): QueuedEvent[] {
  return readJson<QueuedEvent[]>(QUEUE_PATH) ?? [];
}

function writeQueue(queue: QueuedEvent[]): void {
  writeJsonAtomic(QUEUE_PATH, queue);
}

/** Appends an event, dropping the oldest entry if the queue is at capacity. */
export function enqueue(event: QueuedEvent): void {
  const queue = readQueue();
  queue.push(event);
  while (queue.length > MAX_QUEUE_LENGTH) queue.shift();
  writeQueue(queue);
}

export function queueLength(): number {
  return readQueue().length;
}

export interface SendResult {
  ok: boolean;
  /** The server rejected the device token itself (401) — retrying won't help. */
  authRejected: boolean;
}

/**
 * Attempts to deliver queued events in FIFO order via `send`. Stops at the
 * first transient failure (network still down / server 5xx) so ordering and
 * at-least-once delivery are preserved for the remainder — never reorders,
 * never drops those on failure.
 *
 * A 401 is different: every queued event carries the *same* device token, so
 * once one comes back rejected, all of them — and every future queued event —
 * are guaranteed to fail the same way. Retrying forever would just grow the
 * queue file without bound for a token that will never start working again;
 * the whole queue is dropped instead, and the caller (heartbeat.ts) records
 * the rejection so `vibehub-tracker status` can say so.
 */
export async function flushQueue(
  send: (event: QueuedEvent) => Promise<SendResult>
): Promise<{ delivered: number; remaining: number; authRejected: boolean }> {
  const queue = readQueue();
  let delivered = 0;
  let authRejected = false;
  while (queue.length > 0) {
    const result = await send(queue[0]);
    if (result.authRejected) {
      authRejected = true;
      queue.length = 0;
      break;
    }
    if (!result.ok) break;
    queue.shift();
    delivered++;
  }
  writeQueue(queue);
  return { delivered, remaining: queue.length, authRejected };
}
