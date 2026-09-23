import type { Achievement } from "../types";

// The owner's unlock moment — meta/plans/vibehub-honest-achievements-feed.md, B4.
//
// The server persists *when* a badge was earned; the browser decides *whether this
// person has been told*. Every poll diffs the unlocked ids against a per-account seen
// set in localStorage: new id → skew toast + fireworks, once, on the device that saw it
// first. The first run on a device seeds silently — someone who earned four badges last
// month must not get four fireworks the day the feature ships.
//
// Pure, so lib/__checks__/achievementUnlocks.check.ts pins the seeding, the diff and
// the tolerance for a corrupt value without a browser; the hook
// (hooks/useAchievementUnlocks.ts) only supplies the clock, the storage and the toast.

export const seenStorageKey = (userId: string): string => `vh.achievements.seen.${userId}`;

/** The two Storage methods this needs — `window.localStorage` or a test double. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The ids this browser has already celebrated, or null when it has never looked. The
 * two are different answers: null seeds silently, an empty set would announce every
 * unlocked badge. Anything unreadable (private mode, a corrupt value, a non-array)
 * counts as "never looked" — a wrong seed announces nothing, which is the safe error.
 */
export function readSeen(storage: StorageLike | null | undefined, key: string): Set<string> | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return null;
  }
}

/** Sorted, so the stored value is stable across runs; a throwing Storage is ignored. */
export function writeSeen(storage: StorageLike | null | undefined, key: string, ids: ReadonlySet<string>): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify([...ids].sort()));
  } catch {
    // Quota or private mode: the next run seeds again, silently.
  }
}

export interface UnlockDiff {
  /** Badges to celebrate now, in the server's display order. Empty on the first run. */
  announce: Achievement[];
  /** What to store next: everything unlocked now plus everything already seen. */
  next: Set<string>;
}

/**
 * `seen === null` is the first run: nothing is announced and every unlocked id is
 * recorded. Afterwards only ids that are unlocked now and were not seen before are
 * announced. The seen set only ever grows (earned stays earned on the server too), so
 * a badge never re-fires after a flaky poll that briefly omitted it.
 */
export function diffUnlocks(seen: ReadonlySet<string> | null, achievements: readonly Achievement[]): UnlockDiff {
  const unlocked = achievements.filter((a) => a.unlocked);
  const next = new Set<string>(seen ?? []);
  for (const a of unlocked) next.add(a.id);
  const announce = seen === null ? [] : unlocked.filter((a) => !seen.has(a.id));
  return { announce, next };
}
