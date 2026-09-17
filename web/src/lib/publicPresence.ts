// Coarse "Last online" fallback for a public profile visitor who is neither self nor a
// friend — RealtimeContext's live `presences` map (self + accepted friends only) has no
// entry for them. ProfilePage prefers the live entry when one exists; this only feeds
// the gap. See meta/plans/public-last-online-top-tool.md, step 2.
// Pinned by web/src/lib/__checks__/publicPresence.check.ts, run it after touching
// anything below: `node --import tsx src/lib/__checks__/publicPresence.check.ts` (from web/).
import type { PresenceStatus } from "../types";
import type { PresenceLike } from "../components/ui/PresenceBlock";

/**
 * This function's own parameter shape — deliberately looser than the wire contract, not
 * a copy of it. `usersApi.get`'s actual `presence` field (see `ProfileData` in
 * `pages/ProfilePage.tsx`) requires `lastSeenAt`; `lastSeenAt` is optional *here* so this
 * pure function stays defensively usable against a snapshot that only guarantees
 * `status` — a caller with one is still handed a valid, `null`-normalized result,
 * instead of being forced to fabricate a value to satisfy the type.
 */
export interface PublicPresenceSnapshot {
  status: PresenceStatus;
  lastSeenAt?: string | null;
}

/**
 * `null` when there is no snapshot at all (older server, or a user who has never been
 * online) — the caller then renders no presence, same as today's non-friend visitor.
 *
 * Otherwise always `activity: null` and `tools: []`, regardless of `status`: a public
 * visitor may see *that* someone is online, never *what* they're doing or *with what* —
 * that detail is friends-only (`RealtimeContext`'s live `presences` map). Privacy by
 * construction, not by a caller remembering to strip fields.
 */
export function publicPresence(snapshot: PublicPresenceSnapshot | null | undefined): PresenceLike | null {
  if (!snapshot) return null;
  return {
    status: snapshot.status,
    activity: null,
    tools: [],
    lastSeenAt: snapshot.lastSeenAt ?? null,
  };
}
