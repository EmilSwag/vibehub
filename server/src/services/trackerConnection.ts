import type { Request } from "express";
import { prisma } from "../db";
import { HttpError } from "../lib/http-error";
import { presenceFor } from "../lib/sessions";
import { MAX_TRACKER_CONNECTIONS, TRACKER_CONNECTION_PROTOCOL, TrackerConnectionError, trackerConnections } from "../lib/trackerConnection";
import { emitPresenceUpdate } from "../ws/hub";

/** Reject rather than strip data; this protocol has NO client timestamp or AI fields. */
export function assertEmptyTrackerConnectionRequest(req: Request): void {
  const body: unknown = req.body;
  const emptyObject = body !== null && typeof body === "object" &&
    (Object.getPrototypeOf(body) === Object.prototype || Object.getPrototypeOf(body) === null) &&
    Reflect.ownKeys(body).length === 0;
  const length = req.header("content-length");
  const framed = (length !== undefined && length !== "0") || req.header("transfer-encoding") !== undefined;
  const json = /^application\/json(?:\s*;|\s*$)/i.test(req.header("content-type") ?? "");
  // Express 4 can leave {} for an unparsed text/form body. Framing + media type
  // must also agree; otherwise such a body could masquerade as an empty request.
  if ((body !== undefined && !emptyObject) || (framed && (!json || body === undefined))) {
    throw new HttpError(400, "Connection requests must have an empty body");
  }
}

function connectionError(error: unknown): never {
  if (!(error instanceof TrackerConnectionError)) throw error;
  if (error.reason === "identity" || error.reason === "revoked") {
    throw new HttpError(401, "Invalid or revoked tracker token");
  }
  throw new HttpError(503, "Tracker connection temporarily unavailable; retry later");
}

// At most one fan-out per bounded store owner. Do not retain request/response,
// credentials, presence payloads or a durable work queue after this call.
const notifying = new Set<string>();

export async function notifyTrackerConnection(userId: string): Promise<void> {
  if (notifying.has(userId) || notifying.size >= MAX_TRACKER_CONNECTIONS ||
      trackerConnections.notification(userId) === null) return;
  notifying.add(userId);
  try {
    // Coalesce a concurrent receipt/stop/revoke, without an unbounded retry loop.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const revision = trackerConnections.notification(userId);
      if (revision === null) return;
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
      if (user) {
        const presence = await presenceFor(userId, user.username);
        if (trackerConnections.notification(userId) !== revision) continue;
        // Existing emitter scopes recipients to the owner + accepted friends.
        await emitPresenceUpdate(userId, presence);
      }
      trackerConnections.acknowledge(userId, revision);
    }
  } catch {
    // Keep the bounded pending flag for the next 30s sweep. A failed friend lookup
    // must not turn an accepted receipt into a false failure or log raw errors.
  } finally {
    notifying.delete(userId);
  }
}

export async function receiveTrackerConnection(userId: string, deviceId: string) {
  let lastSeenAt: Date;
  try {
    lastSeenAt = trackerConnections.receive(userId, deviceId).lastSeenAt!;
  } catch (error) {
    connectionError(error);
  }
  const receipt = { connected: true as const, lastSeenAt: lastSeenAt.toISOString(), protocol: TRACKER_CONNECTION_PROTOCOL };
  await notifyTrackerConnection(userId);
  return receipt;
}

export async function retireTrackerConnection(userId: string, deviceId: string, revoked = false) {
  let lastSeenAt: Date | null;
  try {
    lastSeenAt = trackerConnections.retire(userId, deviceId, revoked).lastSeenAt;
  } catch (error) {
    connectionError(error);
  }
  const receipt = { connected: false as const, lastSeenAt: lastSeenAt?.toISOString() ?? null, protocol: TRACKER_CONNECTION_PROTOCOL };
  await notifyTrackerConnection(userId);
  return receipt;
}

/** Called by the existing periodic job, including when there are no AI Sessions. */
export async function sweepTrackerConnections(now: Date = new Date()): Promise<void> {
  trackerConnections.sweep(now.getTime());
  for (const { userId } of trackerConnections.notifications()) await notifyTrackerConnection(userId);
}
