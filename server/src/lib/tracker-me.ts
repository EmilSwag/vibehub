import type { PresenceSnapshot, PresenceStatus } from "./sessions";
import { foldEstimatedUsd, type PricedUsage } from "./token-pricing";
import { isTokenlessTool } from "./tools";

/**
 * Payload builder for `GET /api/v1/tracker/me` (ARCHITECTURE.md §5.8) — the single
 * request the macOS companion (`mac/`, VibeHub.app: menu bar + Island) makes.
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
  /**
   * Tokens measured for the open session, or `null` when this tool has no counter in
   * any source (Quadcode). The app must render nothing for null — never "0 tokens",
   * which would state that a measurement was taken and came back empty.
   */
  tokens: number | null;
  since: string;
}

export interface TrackerMeFriend {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: PresenceStatus;
  activity: TrackerMeActivity | null;
  /** Same account-level "last online" self gets, unchanged — see PresenceSnapshot. */
  lastSeenAt: string | null;
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
    /** PresenceSnapshot.lastSeenAt, unchanged — see ARCHITECTURE.md §5.7/§5.9. */
    lastSeenAt: string | null;
  };
  today: {
    activeSeconds: number;
    /**
     * Tokens measured today, or `null` when the day had activity but no measured
     * source produced a count (a Quadcode-only day). Never 0-as-unknown: a `0` here
     * means a measuring tool really did measure nothing, and an empty day is 0 too.
     */
    tokens: number | null;
    /**
     * Start of the session that is open right now, or null when nothing is open.
     * The app ticks "Today" forward from this only while `presence.status` is
     * `active`; `activeSeconds` is already a complete snapshot up to the last
     * heartbeat, so adding elapsed-since-`sessionStartedAt` on top would double count.
     */
    sessionStartedAt: string | null;
    /**
     * Lane B (mac app): today's `tokens` at standard API prices (lib/token-pricing.ts) —
     * an approximation for the Island's "≈$" pill, not money paid. `null` when today's
     * tokens exist but none belong to a model with a verified price; `0` for an empty
     * day. Mixed days (some models priced, some not) report the priced part only.
     * A day whose only work was on a TOKENLESS tool (Quadcode) also reports `null`:
     * nothing was measured, so the cost is unknown rather than zero.
     */
    estimatedUsd: number | null;
    /** The same amount split per model id, priced models only — `{}` when nothing is priced. */
    byModel: Record<string, number>;
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

const iso = (value: Date | null | undefined): string | null =>
  value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;

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
    tokens: activity.tokens,
    since: activity.startedAt,
  };
}

export interface TrackerMeInput {
  user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
  level: number;
  presence: PresenceSnapshot;
  today: { activeSeconds: number; tokens: number | null; sessionStartedAt: Date | null; estimatedUsd: number | null; byModel: Record<string, number> };
  /**
   * Latest actual AI heartbeat or accepted connection receipt, never token use.
   * `/tracker/verify` and this route's middleware update `TrackerToken.lastUsedAt`;
   * that authentication bookkeeping proves neither installation nor daemon life.
   */
  lastSeenAt: Date | null;
  /** Device-scoped connection receipts only; token verification is not last seen. */
  devices: { label: string; lastSeenAt: Date | null }[];
  friends: { user: { username: string; displayName: string | null; avatarUrl: string | null }; presence: PresenceSnapshot }[];
}

export function buildTrackerMePayload(input: TrackerMeInput): TrackerMePayload {
  // Idle includes a reachable daemon with no AI activity. It does not prove that
  // someone is at the keyboard. Use the central presence snapshot unchanged.
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
      lastSeenAt: input.presence.lastSeenAt,
    },
    today: {
      activeSeconds: input.today.activeSeconds,
      tokens: input.today.tokens,
      sessionStartedAt: iso(input.today.sessionStartedAt),
      estimatedUsd: input.today.estimatedUsd,
      byModel: input.today.byModel,
    },
    tracker: {
      connected: input.presence.status !== "offline",
      lastSeenAt: iso(input.lastSeenAt),
      devices: input.devices.map((device) => ({ name: device.label, lastSeenAt: iso(device.lastSeenAt) })),
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
        lastSeenAt: friend.presence.lastSeenAt,
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
 *
 * Lane B (mac app): the same rows, priced. Every row that contributes tokens also
 * contributes a `(model, tokens)` line to the cost fold — DailyStat rows carry the
 * `"unknown"` bucket literal and open sessions a `null` model for presence-only tools,
 * and neither has a price, so both simply make the estimate partial (or null).
 */
export function foldToday(
  dailyStats: { date: Date; model: string; tool?: string | null; tokensInput: number; tokensOutput: number; activeSeconds: number }[],
  openSessions: { startedAt: Date; lastHeartbeatAt: Date; tool?: string | null; model: string | null; tokensInput: number; tokensOutput: number }[],
  today: Date
): { activeSeconds: number; tokens: number | null; sessionStartedAt: Date | null; estimatedUsd: number | null; byModel: Record<string, number> } {
  let activeSeconds = 0;
  let tokens = 0;
  // A measured source is one that actually reports counts: a DailyStat row or an open
  // session whose tool is not tokenless. Its presence is what separates a real 0 from an
  // unknown. The test is the tool in both cases, never the shape of the row - a closed
  // hook session folds into a DailyStat like everything else (fix F-B).
  let hasMeasuredSource = false;
  let hasTokenlessSource = false;
  const priced: PricedUsage[] = [];

  for (const row of dailyStats) {
    if (row.date.getTime() !== today.getTime()) continue;
    activeSeconds += row.activeSeconds;
    if (isTokenlessTool(row.tool)) {
      // Round 6, fix F-B. Closed work used to be assumed measured, and that assumption
      // died the moment a Cursor or Windsurf session ended: the fold saw an ordinary
      // DailyStat row carrying 0/0 and reported today's count as 0 instead of unknown,
      // so a tokenless-only day was honest while the session was open and lied a
      // heartbeat later. Same treatment as the open-session branch below - the time is
      // real, the count is not, and the row is unpriceable rather than free.
      hasTokenlessSource = true;
      priced.push({ model: null, tokensInput: 0, tokensOutput: 0 });
      continue;
    }
    hasMeasuredSource = true;
    tokens += row.tokensInput + row.tokensOutput;
    priced.push({ model: row.model, tokensInput: row.tokensInput, tokensOutput: row.tokensOutput });
  }

  // Newest first, so the freshest open session is the one the menu bar ticks from.
  const sorted = [...openSessions].sort((a, b) => b.lastHeartbeatAt.getTime() - a.lastHeartbeatAt.getTime());
  for (const session of sorted) {
    if (utcMidnight(session.startedAt).getTime() !== today.getTime()) continue;
    activeSeconds += Math.max(0, Math.round((session.lastHeartbeatAt.getTime() - session.startedAt.getTime()) / 1000));
    if (isTokenlessTool(session.tool)) {
      // A tokenless tool measured nothing, so it contributes no tokens AND no price.
      // It is pushed as an unpriceable row rather than skipped: that makes the fold
      // report `estimatedUsd: null` (unknown) for a day of Quadcode-only work,
      // instead of the 0 a zero-token priced row would produce - which would state
      // that nothing was spent. An empty day still reports 0, and a mixed day still
      // reports the priced part.
      hasTokenlessSource = true;
      priced.push({ model: null, tokensInput: 0, tokensOutput: 0 });
      continue;
    }
    hasMeasuredSource = true;
    tokens += session.tokensInput + session.tokensOutput;
    priced.push({ model: session.model, tokensInput: session.tokensInput, tokensOutput: session.tokensOutput });
  }

  const cost = foldEstimatedUsd(priced);
  // Unknown, not zero: a day whose only work was on a tokenless tool measured nothing,
  // so the count is unknown. A day with ANY measured source keeps its real number -
  // including a genuine 0 from a measuring tool that simply used nothing - and an
  // empty day stays 0, because there is nothing to be unknown about.
  const measured = hasMeasuredSource || !hasTokenlessSource ? tokens : null;
  return { activeSeconds, tokens: measured, sessionStartedAt: sorted[0]?.startedAt ?? null, estimatedUsd: cost.estimatedUsd, byModel: cost.byModel };
}

/** Local mirror of `utcDay()` so this module stays free of the db-importing sessions.ts. */
function utcMidnight(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
