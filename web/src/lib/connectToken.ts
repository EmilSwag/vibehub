// Client-side state for the "connect your tools" flow — the one device token a
// browser hands out while it waits for the first heartbeat, and the "seen the
// tracking panel" flag. Everything is per user (keyed by user id) and every
// storage access is guarded: localStorage can throw in private mode / sandboxed
// frames, and the flow must keep working with in-memory state.
//
// Why a stored token at all: onboarding → Home → Settings all render the connect
// card, and each used to mint a fresh token on mount. The prompt the user had
// already copied then pointed at a token that was still valid but orphaned, and
// the account accumulated never-used tokens. Now the first mount mints once and
// every later mount reuses it until it has been used (the tracker sent something
// with it) or revoked.

import { usersApi } from "./api";

export interface StoredConnectToken {
  tokenId: string;
  token: string;
  createdAt: string;
}

const TOKEN_PREFIX = "vh-connect-token:";
const SEEN_PREFIX = "vh-tracking-seen:";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    /* quota / private mode — the caller keeps its in-memory copy */
  }
}

function remove(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

function isStoredToken(value: unknown): value is StoredConnectToken {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as StoredConnectToken).tokenId === "string" &&
    typeof (value as StoredConnectToken).token === "string" &&
    typeof (value as StoredConnectToken).createdAt === "string"
  );
}

/* ---- Connect token ---- */

export function readStoredConnectToken(userId: string): StoredConnectToken | null {
  const raw = read(TOKEN_PREFIX + userId);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredToken(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredConnectToken(userId: string, entry: StoredConnectToken): void {
  write(TOKEN_PREFIX + userId, JSON.stringify(entry));
}

export function clearStoredConnectToken(userId: string): void {
  remove(TOKEN_PREFIX + userId);
}

/**
 * Lazy logout cleanup: AuthContext doesn't know about this store, so on mount
 * any entry that belongs to a *different* account than the one signed in now is
 * dropped. Only this prefix is touched.
 */
export function dropForeignConnectTokens(currentUserId: string): void {
  const store = storage();
  if (!store) return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith(TOKEN_PREFIX) && key !== TOKEN_PREFIX + currentUserId) stale.push(key);
    }
    stale.forEach(remove);
  } catch {
    /* ignore */
  }
}

// One in-flight ensure per user, so two panels mounting in the same tick (Home
// banner + a quick hop to Settings) share a single mint instead of racing.
const pending = new Map<string, Promise<StoredConnectToken>>();

/**
 * The token the connect card should show: the stored one if the server still
 * lists it as non-revoked and never used, otherwise a fresh mint (which also asks
 * the server to revoke this user's other never-used tokens). Never mints twice
 * for the same user while a call is in flight.
 */
export function ensureConnectToken(userId: string, label: string): Promise<StoredConnectToken> {
  const inFlight = pending.get(userId);
  if (inFlight) return inFlight;

  const run = (async (): Promise<StoredConnectToken> => {
    dropForeignConnectTokens(userId);
    const stored = readStoredConnectToken(userId);
    if (stored) {
      try {
        const { tokens } = await usersApi.listTrackerTokens();
        const match = tokens.find((t) => t.id === stored.tokenId);
        if (match && !match.revokedAt && !match.lastUsedAt) return stored;
      } catch {
        // Can't verify right now — trust the copy we have rather than minting
        // another token on top of it; the next mount re-checks.
        return stored;
      }
      // Used (the tracker is on it) or gone (revoked elsewhere): forget it.
      clearStoredConnectToken(userId);
    }
    const res = await usersApi.createTrackerToken(label, { replaceUnused: true });
    const entry: StoredConnectToken = { tokenId: res.tokenId, token: res.token, createdAt: new Date().toISOString() };
    writeStoredConnectToken(userId, entry);
    return entry;
  })();

  pending.set(userId, run);
  run.finally(() => {
    if (pending.get(userId) === run) pending.delete(userId);
  }).catch(() => undefined);
  return run;
}

/* ---- "Seen the tracking panel" flag (Home, first time only) ---- */

export function hasSeenTracking(userId: string): boolean {
  return read(SEEN_PREFIX + userId) === "1";
}

export function markTrackingSeen(userId: string): void {
  write(SEEN_PREFIX + userId, "1");
}
