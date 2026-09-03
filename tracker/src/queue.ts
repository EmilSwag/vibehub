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

/**
 * Attempts to deliver queued events in FIFO order via `send`. Stops at the
 * first failure (network still down) so ordering and at-least-once delivery
 * are preserved for the remainder — never reorders, never drops on failure.
 */
export async function flushQueue(
  send: (event: QueuedEvent) => Promise<boolean>
): Promise<{ delivered: number; remaining: number }> {
  const queue = readQueue();
  let delivered = 0;
  while (queue.length > 0) {
    const ok = await send(queue[0]);
    if (!ok) break;
    queue.shift();
    delivered++;
  }
  writeQueue(queue);
  return { delivered, remaining: queue.length };
}
