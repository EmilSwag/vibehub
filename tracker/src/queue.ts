import type { QueuedEvent } from "./types";

export interface SendResult {
  ok: boolean;
  /** Only a validated bodyless connection-v1 receipt, not an AI activity timestamp. */
  connectionLastSeenAt?: string;
  /** Rejected authentication must suspend collection, not produce a retry backlog. */
  authRejected: boolean;
}

/**
 * Durable replay is disabled under ai-session-metadata-v1. Old queues may carry
 * unrestricted fields and another account's credentials. Never open, parse,
 * replay or rewrite them. Failed new sends are dropped, not persisted; offline
 * usage may be lost. Historical files/data are NOT erased by this restriction.
 * Names remain for CLI/module compatibility.
 */
export function enqueue(_event: QueuedEvent): void {}
export function queueLength(): number { return 0; }
export async function flushQueue(
  _send: (event: QueuedEvent) => Promise<SendResult>
): Promise<{ delivered: number; remaining: number; authRejected: boolean }> {
  return { delivered: 0, remaining: 0, authRejected: false };
}
