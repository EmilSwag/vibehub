import crypto from "node:crypto";
import { env } from "../env";

export interface PairingSession {
  deviceCode: string;
  userCode: string;
  deviceName: string;
  os: "mac" | "windows" | "linux" | "unknown";
  createdAt: number;
  expiresAt: number;
  approvedUserId: string | null;
  issuedToken: string | null;
  claimed: boolean;
}

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_SESSIONS = 1000;

export class PairingStore {
  private readonly byDeviceCode = new Map<string, PairingSession>();
  private readonly byUserCode = new Map<string, PairingSession>();

  constructor() {
    // Periodic cleanup of expired sessions
    setInterval(() => this.cleanup(), 60_000).unref();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [deviceCode, session] of this.byDeviceCode.entries()) {
      if (session.expiresAt <= now || session.claimed) {
        this.byDeviceCode.delete(deviceCode);
        this.byUserCode.delete(session.userCode);
      }
    }
  }

  createSession(deviceName: string, os: string, webUrl?: string): {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    interval: number;
  } {
    this.cleanup();
    if (this.byDeviceCode.size >= MAX_SESSIONS) {
      // Evict oldest session
      const oldestKey = this.byDeviceCode.keys().next().value;
      if (oldestKey) {
        const s = this.byDeviceCode.get(oldestKey);
        if (s) this.byUserCode.delete(s.userCode);
        this.byDeviceCode.delete(oldestKey);
      }
    }

    const deviceCode = crypto.randomBytes(32).toString("hex");
    // Generate clean 8-char user code: VIBE-XXXX
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let randomPart = "";
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) {
      randomPart += alphabet[bytes[i] % alphabet.length];
    }
    const userCode = `VIBE-${randomPart}`;

    const normalizedOs = (
      os === "mac" || os === "darwin" ? "mac" :
      os === "windows" || os === "win32" ? "windows" :
      os === "linux" ? "linux" : "unknown"
    ) as "mac" | "windows" | "linux" | "unknown";

    const cleanDeviceName = (deviceName || "My Device").trim().slice(0, 64) || "My Device";
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;

    const baseWeb = (webUrl || env.corsOrigin.split(",")[0] || "https://web-production-da778.up.railway.app").trim().replace(/\/+$/, "");
    const verificationUri = `${baseWeb}/pair?code=${encodeURIComponent(userCode)}`;

    const session: PairingSession = {
      deviceCode,
      userCode,
      deviceName: cleanDeviceName,
      os: normalizedOs,
      createdAt: now,
      expiresAt,
      approvedUserId: null,
      issuedToken: null,
      claimed: false,
    };

    this.byDeviceCode.set(deviceCode, session);
    this.byUserCode.set(userCode.toUpperCase(), session);

    return {
      deviceCode,
      userCode,
      verificationUri,
      expiresIn: Math.floor(SESSION_TTL_MS / 1000),
      interval: 2,
    };
  }

  getInfo(userCode: string): {
    valid: boolean;
    userCode?: string;
    deviceName?: string;
    os?: "mac" | "windows" | "linux" | "unknown";
    expiresAt?: number;
    alreadyApproved?: boolean;
  } {
    const session = this.byUserCode.get(userCode.toUpperCase().trim());
    if (!session || session.expiresAt <= Date.now() || session.claimed) {
      return { valid: false };
    }
    return {
      valid: true,
      userCode: session.userCode,
      deviceName: session.deviceName,
      os: session.os,
      expiresAt: session.expiresAt,
      alreadyApproved: Boolean(session.approvedUserId),
    };
  }

  approve(userCode: string, userId: string, rawToken: string): boolean {
    const session = this.byUserCode.get(userCode.toUpperCase().trim());
    if (!session || session.expiresAt <= Date.now() || session.claimed || session.approvedUserId) {
      return false;
    }
    session.approvedUserId = userId;
    session.issuedToken = rawToken;
    return true;
  }

  poll(deviceCode: string): {
    status: "pending" | "approved" | "expired";
    token?: string;
    userId?: string;
  } {
    const session = this.byDeviceCode.get(deviceCode.trim());
    if (!session || session.expiresAt <= Date.now() || session.claimed) {
      return { status: "expired" };
    }
    if (!session.approvedUserId || !session.issuedToken) {
      return { status: "pending" };
    }

    const token = session.issuedToken;
    const userId = session.approvedUserId;

    // Single-use claim: delete immediately
    session.claimed = true;
    session.issuedToken = null;
    this.byDeviceCode.delete(deviceCode);
    this.byUserCode.delete(session.userCode);

    return {
      status: "approved",
      token,
      userId,
    };
  }
}

export const pairingStore = new PairingStore();
