import type { FeedEvent, ReactionKind, ReactionResult } from "../types";
import { elapsedShort, relativeDay } from "./format";

// View helpers for the Vibe Feed (components/feed/SocialFeed.tsx) — pure, so
// lib/__checks__/feedEvents.check.ts pins the time labels, the optimistic reaction
// toggle and its reconciliation without React or a server. Every event comes from
// `GET /feed` / `GET /users/:username/feed` (types/index.ts FeedEvent); nothing here
// invents an event, a count or a timestamp.

const DAY_MS = 86_400_000;

/**
 * "now" (live), "just now", "14m ago", "1h 42m ago" inside the first day, then the
 * site's day-grained shape: "yesterday", "5d ago", "Sep 3" (with the year once it is not
 * this one). "" for an unparseable instant, so the caller prints nothing rather than
 * "Invalid Date".
 */
export function feedTimeLabel(event: Pick<FeedEvent, "at" | "live">, now: number = Date.now()): string {
  if (event.live) return "now";
  const at = Date.parse(event.at);
  if (!Number.isFinite(at)) return "";
  if (now - at < DAY_MS) {
    const short = elapsedShort(event.at, now);
    return short === "just now" ? short : `${short} ago`;
  }
  return relativeDay(event.at, now);
}

/** Replace one event by id; every other row keeps its identity so React skips it. */
export function updateEvent(events: readonly FeedEvent[], id: string, update: (event: FeedEvent) => FeedEvent): FeedEvent[] {
  return events.map((event) => (event.id === id ? update(event) : event));
}

/**
 * Flip one reaction locally — the optimistic state shown while the request is in
 * flight. Applying it twice restores the original, which is how a failed request
 * rolls back (the caller guards against two in-flight toggles of the same key).
 */
export function toggleReactionLocally(event: FeedEvent, kind: ReactionKind): FeedEvent {
  const active = !event.reactions.mine[kind];
  return {
    ...event,
    reactions: {
      ...event.reactions,
      [kind]: Math.max(0, event.reactions[kind] + (active ? 1 : -1)),
      mine: { ...event.reactions.mine, [kind]: active },
    },
  };
}

/**
 * What the server actually recorded. Its `active` and `count` replace the optimistic
 * guess — another account may have reacted meanwhile, and a double tap that raced the
 * unique index lands on the same "on" state. A result for a different target is ignored.
 */
export function applyReactionResult(event: FeedEvent, result: ReactionResult): FeedEvent {
  if (result.target !== event.id) return event;
  return {
    ...event,
    reactions: {
      ...event.reactions,
      [result.kind]: Math.max(0, result.count),
      mine: { ...event.reactions.mine, [result.kind]: result.active },
    },
  };
}

/**
 * "Load more": append the next page, dropping any id already on screen. The cursor is
 * strictly-older-than so pages do not overlap, but a live session that ended between
 * two pages moves its `at` and could otherwise appear twice.
 */
export function appendPage(existing: readonly FeedEvent[], page: readonly FeedEvent[]): FeedEvent[] {
  const seen = new Set(existing.map((event) => event.id));
  return [...existing, ...page.filter((event) => !seen.has(event.id))];
}
