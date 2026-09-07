import type { PresenceSnapshot, PresenceStatus } from "./sessions";

/**
 * Payload builder for `GET /api/v1/tracker/me` (ARCHITECTURE.md §5.9) — the single
 * request the macOS menu-bar companion (`menubar-mac/`) makes.
 *
 * Deliberately pure and Prisma-free: the route fetches rows, this file shapes them.
 * That seam is what makes the contract assertable without a database — see
 * `__checks__/trackerMe.check.ts`. Nothing here reads the clock either; `now` is
 * always passed in, so the checks are deterministic.
 *
 * Every timestamp leaves as an ISO string (not a Date) so the wire shape is identical
 * whether it came from `res.json()`'s serializer or from a check, and so Swift's
 * `Codable` sees one type per field.
 */

/** Activity as the menu bar renders it: `project · tool · model`, ticking from `since`. */
export interface TrackerMeActivity {
  project: string;
  tool: string;
  /** null when the tool exposes no model — the app drops the segment, never prints "unknown". */
  model: string | null;
  since: string;
}

export interface TrackerMeFriend {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: PresenceStatus;
  activity: TrackerMeActivity | null;
}

export interface TrackerMePayload {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    level: number;
  };
  presence: {
    status: PresenceStatus;
    activity: TrackerMeActivity | null;
  };
  today: {
    activeSeconds: number;
    tokens: number;
    /**
     * Start of the session that is open right now, or null when nothing is open.
     * The app ticks "Today" forward from this only while `presence.status` is
     * `active`; `activeSeconds` is already a complete snapshot up to the last
     * heartbeat, so adding elapsed-since-`sessionStartedAt` on top would double count.
     */
    sessionStartedAt: string | null;
  };
  tracker: {
    connected: boolean;
    lastSeenAt: string | null;
    devices: { name: string; lastSeenAt: string | null }[];
  };
  friendsOnline: {
    count: number;
    sample: TrackerMeFriend[];
  };
}

/** How many friends the popover can actually draw (spec: up to 4 avatars). */
export const FRIENDS_SAMPLE_LIMIT = 4;

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

/**
 * `PresenceActivity` (projectAlias/startedAt) → the menu bar's naming (project/since).
 * The rename is the wire contract, not cosmetic: it keeps the Swift model free of the
 * server's internal "alias" vocabulary.
 */
function toActivity(activity: PresenceSnapshot["activity"]): TrackerMeActivity | null {
  if (!activity) return null;
  return {
    project: activity.projectAlias,
    tool: activity.tool,
    model: activity.model,
    since: activity.startedAt,
  };
}

export interface TrackerMeInput {
  user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
  level: number;
  presence: PresenceSnapshot;
  today: { activeSeconds: number; tokens: number; sessionStartedAt: Date | null };
  /**
   * Heartbeat-derived, NOT `TrackerToken.lastUsedAt`. `lastUsedAt` is bumped by
   * `/tracker/verify` and by this route's own middleware, so deriving `connected`
   * from it reports a connected tracker the instant `login` runs — the Round 5
   * regression that hid the Home banner while presence stayed empty
   * (see the note above `GET /users/me/tracker` in routes/users.ts).
   */
  lastSeenAt: Date | null;
  devices: { label: string; lastUsedAt: Date | null }[];
  friends: { user: { username: string; displayName: string | null; avatarUrl: string | null }; presence: PresenceSnapshot }[];
}

export function buildTrackerMePayload(input: TrackerMeInput): TrackerMePayload {
  // "Online" is anything not offline: an idle friend is still at the keyboard and is
  // worth showing, greyed. Same active/idle/offline split `presenceFor()` already
  // decayed from lastHeartbeatAt.
  const online = input.friends.filter((friend) => friend.presence.status !== "offline");

  return {
    user: {
      id: input.user.id,
      username: input.user.username,
      displayName: input.user.displayName,
      avatarUrl: input.user.avatarUrl,
      level: input.level,
    },
    presence: {
      status: input.presence.status,
      activity: toActivity(input.presence.activity),
    },
    today: {
      activeSeconds: input.today.activeSeconds,
      tokens: input.today.tokens,
      sessionStartedAt: iso(input.today.sessionStartedAt),
    },
    tracker: {
      connected: input.presence.status !== "offline",
      lastSeenAt: iso(input.lastSeenAt),
      devices: input.devices.map((device) => ({ name: device.label, lastSeenAt: iso(device.lastUsedAt) })),
    },
    friendsOnline: {
      // `count` is every online friend; `sample` is only what fits in the popover, so
      // "Friends online: 12" can render beside four avatars without a second request.
      count: online.length,
      sample: online.slice(0, FRIENDS_SAMPLE_LIMIT).map((friend) => ({
        username: friend.user.username,
        displayName: friend.user.displayName,
        avatarUrl: friend.user.avatarUrl,
        status: friend.presence.status,
        activity: toActivity(friend.presence.activity),
      })),
    },
  };
}

/**
 * Today's active seconds + tokens, folded the same way `GET /users/me/tracker` does it
 * (routes/users.ts): closed work lives in DailyStat rows dated today, and sessions that
 * are still open carry time/tokens that haven't been folded yet. Open sessions are
 * bucketed by their *start* day — the same day `foldIntoDailyStat` will use when they
 * close — so a session that began yesterday and is still running does not land on today.
 *
 * Elapsed is measured to `lastHeartbeatAt`, never to `now`: a tracker that died mid
 * session must not keep accruing time.
 */
export function foldToday(
  dailyStats: { date: Date; tokensInput: number; tokensOutput: number; activeSeconds: number }[],
  openSessions: { startedAt: Date; lastHeartbeatAt: Date; tokensInput: number; tokensOutput: number }[],
  today: Date
): { activeSeconds: number; tokens: number; sessionStartedAt: Date | null } {
  let activeSeconds = 0;
  let tokens = 0;

  for (const row of dailyStats) {
    if (row.date.getTime() !== today.getTime()) continue;
    activeSeconds += row.activeSeconds;
    tokens += row.tokensInput + row.tokensOutput;
  }

  // Newest first, so the freshest open session is the one the menu bar ticks from.
  const sorted = [...openSessions].sort((a, b) => b.lastHeartbeatAt.getTime() - a.lastHeartbeatAt.getTime());
  for (const session of sorted) {
    if (utcMidnight(session.startedAt).getTime() !== today.getTime()) continue;
    activeSeconds += Math.max(0, Math.round((session.lastHeartbeatAt.getTime() - session.startedAt.getTime()) / 1000));
    tokens += session.tokensInput + session.tokensOutput;
  }

  return { activeSeconds, tokens, sessionStartedAt: sorted[0]?.startedAt ?? null };
}

/** Local mirror of `utcDay()` so this module stays free of the db-importing sessions.ts. */
function utcMidnight(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
