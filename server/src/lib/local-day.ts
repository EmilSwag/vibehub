/**
 * The user's LOCAL calendar day (meta/plans/vibehub-qa-fix.md, "today window").
 *
 * "Today" used to be the UTC day, so at 00:00 UTC a UTC+3 user's /tracker/me and web
 * Home dropped to 0 at 03:00 their time. A day is now the local calendar day of the
 * tracker host, read from `Session.tzOffsetMinutes` (minutes to ADD to UTC, sent by the
 * tracker; null = unknown = UTC, exactly the old behaviour).
 *
 * No schema change: `DailyStat.date` stays a UTC-midnight DateTime, but it now carries
 * the LOCAL date - local 2026-09-26 is keyed 2026-09-26T00:00:00Z whatever the zone.
 * Rows written before this are keyed by UTC date and are not backfilled.
 *
 * Pure and Prisma-free: tracker-me.ts and the fixture harness load it without a DB.
 */

/** Widest real UTC offset is 14 h; anything else is not a zone and reads as unknown. */
const MAX_TZ_OFFSET_MINUTES = 840;
const DAY_MS = 86_400_000;

/** A usable offset, or 0 (UTC) for null/undefined/garbage - never a guessed zone. */
export function tzOffsetOrUtc(value: number | null | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= MAX_TZ_OFFSET_MINUTES ? value : 0;
}

/** The DailyStat key for the local day containing `at`: the UTC midnight carrying that local date. */
export function localDay(at: Date, tzOffsetMinutes: number | null | undefined): Date {
  const shifted = new Date(at.getTime() + tzOffsetOrUtc(tzOffsetMinutes) * 60_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** The real instant a local day (given by its key) starts, and the next one's start. */
export function localDayWindow(day: Date, tzOffsetMinutes: number | null | undefined): { start: number; end: number } {
  const start = day.getTime() - tzOffsetOrUtc(tzOffsetMinutes) * 60_000;
  return { start, end: start + DAY_MS };
}

/**
 * A session's active seconds split at LOCAL midnights, oldest day first - what
 * closeSession books into DailyStat. Bounded: past `maxDays` the remainder lands on the
 * last day.
 */
export function secondsByLocalDay(
  startedAt: Date, endedAt: Date, tzOffsetMinutes: number | null | undefined, maxDays = 31
): { day: Date; seconds: number }[] {
  const out: { day: Date; seconds: number }[] = [];
  const end = endedAt.getTime();
  let cursor = startedAt.getTime();
  if (!(end > cursor)) return [{ day: localDay(startedAt, tzOffsetMinutes), seconds: 0 }];
  while (cursor < end) {
    const day = localDay(new Date(cursor), tzOffsetMinutes);
    const stop = out.length === maxDays - 1 ? end : Math.min(end, localDayWindow(day, tzOffsetMinutes).end);
    out.push({ day, seconds: Math.round((stop - cursor) / 1000) });
    cursor = stop;
  }
  return out;
}

/**
 * What an OPEN session contributes to local day `today` right now: its seconds inside
 * that day (measured to lastHeartbeatAt, never to now), and whether it STARTED that day
 * (its legacy Session tokens belong to its start day, where closeSession folds them).
 * The session's own zone draws the day's edges - the same edges closeSession will use -
 * so the live number and the folded one agree. Shared by /tracker/me and
 * /users/me/tracker so the two endpoints cannot disagree.
 */
export function openSessionToday(
  session: { startedAt: Date; lastHeartbeatAt: Date; tzOffsetMinutes?: number | null },
  today: Date
): { seconds: number; startedToday: boolean; overlaps: boolean } {
  const { start, end } = localDayWindow(today, session.tzOffsetMinutes);
  const from = Math.max(session.startedAt.getTime(), start);
  const to = Math.min(session.lastHeartbeatAt.getTime(), end);
  const startedToday = localDay(session.startedAt, session.tzOffsetMinutes).getTime() === today.getTime();
  return { seconds: Math.max(0, Math.round((to - from) / 1000)), startedToday, overlaps: to >= from || startedToday };
}
