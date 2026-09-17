// "Last online" label for offline/idle presence — friend surfaces (FriendListItem,
// Home's "All friends") and the profile hero (ProfilePage), all via PresenceBlock.
// Reuses format.ts's pre-existing `elapsedShort` (sub-day) and `daysSince` (day
// count, given an injected `now`) rather than a parallel reimplementation of either
// — see `relativeOrDate` below for exactly how much of each is reuse vs. glue.
// `formatShortDate` covers the >7-day branch. TrackingStatus.tsx / ConnectSheet.tsx
// are untouched by this module. Pinned by web/src/lib/__checks__/lastOnline.check.ts,
// run it after touching anything below:
// `node --import tsx src/lib/__checks__/lastOnline.check.ts` (from web/).
import type { PresenceStatus } from "../types";
import { daysSince, elapsedShort, formatShortDate } from "./format";

/** Structural subset every `Presence`-shaped value has — `Presence` itself,
 * `TrackerStatus.presence`, and a normalized `presence:update` event all fit. */
export interface LastOnlineLike {
  status: PresenceStatus;
  lastSeenAt: string | null;
}

/**
 * "just now" (<1m, `elapsedShort`'s own cutoff) / "12m ago" / "2h ago" / "3d ago" /
 * "Sep 12" (>7d, `formatShortDate`). `null` when `iso` doesn't parse.
 *
 * Composed entirely from two pre-existing `format.ts` helpers, not a parallel
 * bucket ladder:
 *  - `daysSince(iso, now)` (now injectable, added for this) gives the day count
 *    directly — used as-is for the 1–7 day bucket ("Nd ago"), and to decide the
 *    >7-day cutover to `formatShortDate`.
 *  - `elapsedShort(iso, now)` covers everything under a day. Its own shape is
 *    "just now" / "Nm" / "Nh Nm" — for the hour case this function keeps only the
 *    leading hour count (`"2h 0m"` → `"2h ago"`) rather than re-deriving hours
 *    itself, since `elapsedShort` already computed it; for "just now"/"Nm" it only
 *    appends " ago" (or nothing, for "just now"). No independent ms-diff math is
 *    performed here beyond the single day-count comparison already noted.
 * Both reused helpers already clamp negative (future) elapsed to zero internally,
 * so a future `iso` reads as "just now" with no separate handling needed here.
 */
function relativeOrDate(iso: string, now: number): string | null {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  const days = daysSince(iso, now);
  if (days > 7) return formatShortDate(iso);
  if (days >= 1) return `${days}d ago`;
  const elapsed = elapsedShort(iso, now);
  if (elapsed === "just now") return elapsed;
  const hours = /^(\d+)h/.exec(elapsed);
  return hours ? `${hours[1]}h ago` : `${elapsed} ago`;
}

/**
 * The understated line under a name on friend surfaces / the profile hero:
 *
 *   - `"Last online 2h ago"` / `"Last online 3d ago"` / `"Last online Sep 12"` (>7d) /
 *     `"Last online just now"` (<1m, `elapsedShort`'s own cutoff) — offline with a
 *     known `lastSeenAt`.
 *   - `"Offline"` — offline, never seen (`lastSeenAt` is `null`). Callers that already
 *     show the bare status word on its own line (PresenceBlock's line 1) should skip
 *     rendering this case rather than repeat the same word a second time — this
 *     function stays pure and always returns the full contract regardless.
 *   - `"idle · last active 2h ago"` — idle with a known `lastSeenAt`, activity or not.
 *   - `null` — `status === "active"` (the elapsed line already covers it), idle with
 *     no `lastSeenAt` (nothing to report), or an unparseable `lastSeenAt`.
 *
 * Pure; inject `now` for tests and ticking UIs, same convention as `elapsedShort`.
 */
export function lastOnlineLabel(presence: LastOnlineLike, now: number = Date.now()): string | null {
  if (presence.status === "active") return null;
  if (presence.lastSeenAt == null) return presence.status === "offline" ? "Offline" : null;
  const core = relativeOrDate(presence.lastSeenAt, now);
  if (core === null) return null;
  return presence.status === "idle" ? `idle · last active ${core}` : `Last online ${core}`;
}

/**
 * WS `presence:update`'s `lastSeenAt` merge rule: an omitted key (`undefined`) means
 * "unchanged" — keep whatever this username's last known value was — while an
 * *explicit* `null` clears it. Only defaults to `null` when there is no prior value
 * either (the first event ever seen for a username, e.g. racing the initial snapshot
 * fetch). Extracted from `RealtimeContext.tsx`'s WS handler so the rule is testable
 * without React or a socket.
 */
export function mergeLastSeenAt(
  previous: string | null | undefined,
  incoming: string | null | undefined
): string | null {
  return incoming !== undefined ? incoming : previous ?? null;
}
