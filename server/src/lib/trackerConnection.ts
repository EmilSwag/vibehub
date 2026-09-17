/**
 * Transport liveness only. No database, filesystem, token, payload or AI metadata.
 * Process-local by design: restart clears it. A shared store is REQUIRED before
 * running multiple API processes/replicas; sticky routing alone is not sufficient.
 */
export const TRACKER_CONNECTION_PROTOCOL = "connection-v1" as const;
export const TRACKER_CONNECTION_TTL_MS = 90_000;
export const TRACKER_CONNECTION_RETENTION_MS = 24 * 60 * 60_000;
export const TRACKER_AUTH_MAX_AGE_MS = 30_000;
export const MAX_TRACKER_CONNECTIONS = 10_000;
export const MAX_TRACKER_CONNECTIONS_PER_USER = 32;

export interface TrackerConnectionSnapshot {
  connected: boolean;
  lastSeenAt: Date | null;
}

export class TrackerConnectionError extends Error {
  constructor(public readonly reason: "identity" | "clock" | "capacity" | "revoked") {
    super(`Tracker connection ${reason}`);
  }
}

interface DeviceConnection {
  lastSeenAt: number | null;
  live: boolean;
  revokedAt: number | null;
}

interface OwnerConnections {
  devices: Map<string, DeviceConnection>;
  revision: number;
  pending: boolean;
  changedAt: number;
}

interface StoreOptions {
  now?: () => number;
  maxDevices?: number;
  maxDevicesPerUser?: number;
}

function validClock(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
}

/** Accept actual Date values only; missing, invalid or future dates never mean now. */
export function trackerTimestamp(value: unknown, now: number = Date.now()): number | null {
  if (!validClock(now) || !(value instanceof Date)) return null;
  const at = value.getTime();
  return validClock(at) && at <= now ? at : null;
}

function validId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\s\u0000-\u001f\u007f]/.test(value);
}

export class TrackerConnectionStore {
  private readonly owners = new Map<string, OwnerConnections>();
  private readonly now: () => number;
  private readonly maxDevices: number;
  private readonly maxDevicesPerUser: number;
  private deviceCount = 0;
  private revision = 0;
  private rejectNewUntil = 0;

  constructor(options: StoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxDevices = options.maxDevices ?? MAX_TRACKER_CONNECTIONS;
    this.maxDevicesPerUser = options.maxDevicesPerUser ?? MAX_TRACKER_CONNECTIONS_PER_USER;
    for (const limit of [this.maxDevices, this.maxDevicesPerUser]) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TRACKER_CONNECTIONS) {
        throw new TrackerConnectionError("capacity");
      }
    }
  }

  private time(): number {
    const now = this.now();
    if (!validClock(now)) throw new TrackerConnectionError("clock");
    return now;
  }

  private identity(userId: string, deviceId: string): void {
    if (!validId(userId) || !validId(deviceId)) throw new TrackerConnectionError("identity");
  }

  private changed(owner: OwnerConnections, now: number): void {
    owner.revision = ++this.revision;
    owner.pending = true;
    owner.changedAt = now;
  }

  private device(userId: string, deviceId: string, now: number): DeviceConnection {
    const existing = this.owners.get(userId)?.devices.get(deviceId);
    if (existing) return existing;
    // No live eviction. Retained receipts/tombstones and pending owners are bounded
    // too; when full, new devices fail closed until a sweep frees capacity.
    let owner = this.owners.get(userId);
    const full = () => this.deviceCount >= this.maxDevices ||
      (!owner && this.owners.size >= this.maxDevices) ||
      (owner !== undefined && owner.devices.size >= this.maxDevicesPerUser);
    if (full()) {
      this.sweep(now);
      owner = this.owners.get(userId);
      if (full()) throw new TrackerConnectionError("capacity");
    }
    if (!owner) {
      owner = { devices: new Map(), revision: 0, pending: false, changedAt: now };
      this.owners.set(userId, owner);
    }
    const created: DeviceConnection = { lastSeenAt: null, live: false, revokedAt: null };
    owner.devices.set(deviceId, created);
    this.deviceCount += 1;
    return created;
  }

  /** Called only after successful tracker authentication and empty-body validation. */
  receive(userId: string, deviceId: string): TrackerConnectionSnapshot {
    this.identity(userId, deviceId);
    const now = this.time();
    if (!this.owners.get(userId)?.devices.has(deviceId) && now < this.rejectNewUntil) {
      throw new TrackerConnectionError("capacity");
    }
    const device = this.device(userId, deviceId, now);
    if (device.revokedAt !== null) throw new TrackerConnectionError("revoked");
    if (device.lastSeenAt !== null && now < device.lastSeenAt) throw new TrackerConnectionError("clock");
    device.lastSeenAt = now;
    device.live = true;
    this.changed(this.owners.get(userId)!, now);
    return { connected: true, lastSeenAt: new Date(now) };
  }

  /** Stop only this credential. A revocation tombstone fences already-in-flight auth. */
  retire(userId: string, deviceId: string, revoked = false): TrackerConnectionSnapshot {
    this.identity(userId, deviceId);
    const now = this.time();
    let device = this.owners.get(userId)?.devices.get(deviceId);
    if (!device && revoked) {
      try {
        device = this.device(userId, deviceId, now);
      } catch (error) {
        if (!(error instanceof TrackerConnectionError) || error.reason !== "capacity") throw error;
        // A saturated cache cannot hold another tombstone. Don't evict anyone:
        // fence NEW receipts for the maximum in-flight auth lifetime instead.
        this.rejectNewUntil = Math.max(this.rejectNewUntil, now + TRACKER_AUTH_MAX_AGE_MS);
      }
    }
    if (!device) return { connected: false, lastSeenAt: null };
    if (device.live || (revoked && device.revokedAt === null)) {
      device.live = false;
      if (revoked) device.revokedAt = now;
      this.changed(this.owners.get(userId)!, now);
    }
    return { connected: false, lastSeenAt: this.snapshot(userId, deviceId, now).lastSeenAt };
  }

  /** Pure read: neither refreshes a lease nor consumes an expiry notification. */
  snapshot(userId: string, deviceId: string, now: number = this.now()): TrackerConnectionSnapshot {
    const device = this.owners.get(userId)?.devices.get(deviceId);
    const at = device?.lastSeenAt;
    if (!validClock(now) || at == null || !validClock(at) || now < at ||
        now - at >= TRACKER_CONNECTION_RETENTION_MS) {
      return { connected: false, lastSeenAt: null };
    }
    return {
      connected: Boolean(device?.live && device.revokedAt === null && now - at < TRACKER_CONNECTION_TTL_MS),
      lastSeenAt: new Date(at),
    };
  }

  forUser(userId: string, now: number = this.now()): TrackerConnectionSnapshot {
    let connected = false;
    let lastSeenAt: Date | null = null;
    for (const deviceId of this.owners.get(userId)?.devices.keys() ?? []) {
      const snapshot = this.snapshot(userId, deviceId, now);
      connected ||= snapshot.connected;
      if (snapshot.lastSeenAt && (!lastSeenAt || snapshot.lastSeenAt > lastSeenAt)) lastSeenAt = snapshot.lastSeenAt;
    }
    return { connected, lastSeenAt };
  }

  /** Expire at the SAME boundary as reads; delivery is retried by the existing job. */
  sweep(now: number = this.now()): void {
    if (!validClock(now)) return;
    for (const [userId, owner] of this.owners) {
      for (const [deviceId, device] of owner.devices) {
        const age = device.lastSeenAt === null ? null : now - device.lastSeenAt;
        if (device.live && (age === null || age < 0 || age >= TRACKER_CONNECTION_TTL_MS)) {
          device.live = false;
          this.changed(owner, now);
        }
        if (age !== null && age >= TRACKER_CONNECTION_RETENTION_MS) device.lastSeenAt = null;
        if (device.revokedAt !== null && now - device.revokedAt >= TRACKER_CONNECTION_RETENTION_MS) device.revokedAt = null;
        if (device.lastSeenAt === null && device.revokedAt === null) {
          owner.devices.delete(deviceId);
          this.deviceCount -= 1;
        }
      }
      // A failed fan-out keeps only a bounded owner notification, not an old receipt.
      if (owner.devices.size === 0 && (!owner.pending || now - owner.changedAt >= TRACKER_CONNECTION_RETENTION_MS)) {
        this.owners.delete(userId);
      }
    }
  }

  notifications(): { userId: string; revision: number }[] {
    return [...this.owners].filter(([, owner]) => owner.pending)
      .map(([userId, owner]) => ({ userId, revision: owner.revision }));
  }

  notification(userId: string): number | null {
    const owner = this.owners.get(userId);
    return owner?.pending ? owner.revision : null;
  }

  acknowledge(userId: string, revision: number): void {
    const owner = this.owners.get(userId);
    if (!owner || owner.revision !== revision) return;
    owner.pending = false;
    if (owner.devices.size === 0) this.owners.delete(userId);
  }

  /** Counts only, for bounded-cache checks; never exposes identities or receipts. */
  get size(): { devices: number; owners: number; pending: number } {
    return { devices: this.deviceCount, owners: this.owners.size, pending: this.notifications().length };
  }
}

export const trackerConnections = new TrackerConnectionStore();

/** Account history merges real AI heartbeats and accepted transport receipts only. */
export function latestTrackerLastSeenAt(userId: string, heartbeat: unknown, now: number = Date.now()): Date | null {
  const ai = trackerTimestamp(heartbeat, now);
  const connection = trackerTimestamp(trackerConnections.forUser(userId, now).lastSeenAt, now);
  const latest = ai === null ? connection : connection === null ? ai : Math.max(ai, connection);
  return latest === null ? null : new Date(latest);
}
