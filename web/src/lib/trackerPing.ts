// The connect sheet's lifecycle, as pure functions.
//
// Extracted from useTrackerPing (2026-09-14) so the rules that decide "is this a real
// connection?" can be asserted without React, a DOM or a server. The hook is then only
// plumbing: sessions, fetching, timers. Every branch below exists because the previous
// version got it wrong and closed the sheet on a connection nobody had just made.
//
// Pinned by lib/__checks__/trackerPing.check.ts — run it after touching this file:
// `npx tsx web/src/lib/__checks__/trackerPing.check.ts`.

/** The furthest step reached, in order. "Copied" is the sheet's own business — it
 *  knows when the button was pressed — so it is not a stage here. */
export type PingStage = "idle" | "waiting" | "pinged" | "live";

/**
 * Strictly newer, and a real timestamp on both sides.
 *
 * A null `b` is deliberately *not* "everything is newer than nothing". That reading is
 * what let an old offline ping count as a fresh one in the window before the baseline
 * had been established — and since the baseline is reset on every open, that window
 * was every open. Callers must gate on `baselineReady` as well; this only refuses the
 * unparseable.
 */
export function newer(a: string | null, b: string | null): boolean {
  if (a === null) return false;
  const at = Date.parse(a);
  if (Number.isNaN(at)) return false;
  if (b === null) return true;
  const bt = Date.parse(b);
  return Number.isNaN(bt) ? true : at > bt;
}

/** One open of the sheet, for one user. A reopen is a different session even if every
 *  other input is identical, which is what makes a rapid reopen distinguishable. */
export const sessionKeyOf = (open: boolean, userId: string | null): string => `${open}:${userId ?? ""}`;

/**
 * Only the current session's snapshot is visible. A snapshot from a previous open is
 * not "the last known state" — it is a claim about a different moment, and believing
 * it is what let a rapid reopen read as already-live.
 */
export function visibleSnapshot<T>(snap: { session: number; status: T } | null, session: number): T | null {
  return snap !== null && snap.session === session ? snap.status : null;
}

/** The baseline and the initial-live flag belong to the same server observation.
 * Keeping them together prevents a previous open's flags surviving a new session. */
export interface PingObservation<T> {
  tracker: T;
  baselineAt: string | null;
  liveAtOpen: boolean;
}

export function observePing<T extends { lastSeenAt: string | null; presence: { status: string } }>(
  previous: PingObservation<T> | null,
  tracker: T,
): PingObservation<T> {
  return {
    tracker,
    baselineAt: previous ? previous.baselineAt : tracker.lastSeenAt,
    liveAtOpen: previous
      ? previous.liveAtOpen
      : tracker.presence.status === "active" && newer(tracker.lastSeenAt, null),
  };
}

export interface PingInputs {
  /** The reader has done something here — copied a command. A reason to watch, never
   *  evidence that anything was installed or started. */
  started: boolean;
  /** Presence said "active" on this session's *first* successful fetch. */
  liveAtOpen: boolean;
  /** This session has established what "already pinged" looked like. */
  baselineReady: boolean;
  /** That baseline. */
  baselineAt: string | null;
  /** A snapshot belonging to this session exists. */
  hasSnapshot: boolean;
  /** Its `lastSeenAt`. */
  lastSeenAt: string | null;
  /** Its presence word. */
  presenceActive: boolean;
}

/**
 * A ping this session actually witnessed.
 *
 * All four guards matter. Without `baselineReady` an old timestamp counts the instant
 * the sheet opens; without `hasSnapshot` a previous session's data answers for this
 * one; without a strictly-newer comparison a cached "active" on a rapid reopen counts;
 * and a copy or a stored token never reaches here at all, because neither produces a
 * snapshot.
 */
export function freshPing(i: PingInputs): boolean {
  return i.baselineReady && i.hasSnapshot && newer(i.lastSeenAt, i.baselineAt);
}

/**
 * The stage the step list should show.
 *
 * `liveAtOpen` rests at "live" without ever having waited — the `/?connect=1` deep
 * link lands there — and the sheet must not treat that as an event (see
 * `shouldCelebrate`). Otherwise "live" needs *both* halves: a fresh ping and presence
 * saying active. Presence alone used to be enough, and presence alone is exactly what
 * a stale snapshot carries.
 */
export function pingStage(i: PingInputs): PingStage {
  if (!i.baselineReady || !i.hasSnapshot) return i.started || i.liveAtOpen ? "waiting" : "idle";
  const fresh = freshPing(i);
  if ((i.liveAtOpen || fresh) && i.presenceActive && newer(i.lastSeenAt, null)) return "live";
  if (fresh) return "pinged";
  return i.started || i.liveAtOpen ? "waiting" : "idle";
}

/**
 * Close the sheet and celebrate — only for a transition into live that this session
 * watched happen. An account that was already tracking when the sheet opened has
 * nothing to congratulate, and closing on it would slam the sheet shut on someone who
 * asked to see it.
 */
export function shouldCelebrate(stage: PingStage, liveAtOpen: boolean): boolean {
  return stage === "live" && !liveAtOpen;
}

/* ---- what the sheet may claim about an existing install ---- */

/** Just the parts of TrackerStatus this note reads, so the rule stays pure. */
export interface NoteStatus {
  presence: { status: string };
  devices: readonly { label: string; lastUsedAt: string | null }[];
}

export interface InstalledNote {
  /** One line, always shown. */
  lead: string;
  /** The rest, behind a disclosure — a banner is not the place for the reinstall
   *  caveat unless it is asked for. Absent when there is nothing to qualify. */
  detail?: string;
}

/**
 * The line above the steps, and the only thing the sheet says about a machine it
 * cannot see.
 *
 * Three outcomes, and the boundaries between them are the point:
 *
 * - **Tracking now** — said about the *account*, never "this machine". The ping could
 *   be coming from any device the account owns and this browser cannot tell which.
 * - **Offline, with a device the server has actually seen** — "last tracked from",
 *   not "installed on": a heartbeat proves a tracker ran, not that one is installed
 *   now. The advice is to *start* it again, because an installed-but-offline tracker
 *   needs starting, not reinstalling.
 * - **Anything else** — silence. A device row with no `lastUsedAt` is a token that was
 *   minted and never used; naming it would invent a machine out of a label.
 *
 * `ago` is injected so this stays free of the component that formats it.
 */
/* ---- a tracker running with a token the server has revoked ---- */

/** The two sentences, defined once. Three surfaces render them; none owns the wording. */
export const STALE_TRACKER_LEAD = "Tracker is running with an old token.";
export const STALE_TRACKER_FIX = "Redo step 1 and step 2. Start replaces it.";

/** Just the parts of TrackerStatus this rule reads, so it stays pure and testable. */
export interface StaleStatus {
  connected: boolean;
  /** Last *accepted* heartbeat. A rejected one never moves it. */
  lastSeenAt?: string | null;
  staleTracker?: { lastRejectedAt: string; label: string | null; revokedAt: string } | null;
}

export interface StaleTrackerHintCopy {
  lead: string;
  fix: string;
  /** The server's timestamp, for the sheet's freshness gate. */
  lastRejectedAt: string;
}

/**
 * Should a surface say "a tracker here is running with a revoked token"?
 *
 * `staleTracker` alone is not enough: a second machine's dead token being rejected while
 * *this* one heartbeats fine would otherwise put a warning on a working setup. So the
 * rejection has to be *newer than the last accepted heartbeat* — nothing the server
 * trusts has spoken since it turned a tracker away.
 *
 * That test replaces the old `!connected` gate (round 12). `connected` lingers for the
 * whole presence window after the last good ping, so revoking your only device used to
 * leave Settings saying "Connected" over "No devices yet." for two minutes, with the one
 * sentence that explains it suppressed. While the account is offline the rule is the same
 * as before: a rejection with no accepted ping after it is exactly the stale case.
 *
 * Optional-by-design: a server that predates the field omits it, and this returns null,
 * which is exactly the old behaviour.
 */
export function staleTrackerHint(status: StaleStatus | null): StaleTrackerHintCopy | null {
  if (!status) return null;
  const stale = status.staleTracker;
  if (!stale) return null;
  const rejectedAt = Date.parse(stale.lastRejectedAt);
  const seenAt = status.lastSeenAt ? Date.parse(status.lastSeenAt) : 0;
  if (Number.isFinite(rejectedAt) && Number.isFinite(seenAt) && seenAt >= rejectedAt) return null;
  return { lead: STALE_TRACKER_LEAD, fix: STALE_TRACKER_FIX, lastRejectedAt: stale.lastRejectedAt };
}

/**
 * The connect sheet's extra gate: only speak while the rejection is newer than the moment
 * this attempt started waiting.
 *
 * The sheet is a live, step-by-step surface — what it says is read as being about the
 * command just run. A rejection from hours ago is a true fact about the account and a
 * misleading one here: it would tell someone who just pasted a fresh token that their
 * tracker is running with an old one. Home and Settings are ambient and have no such
 * moment, so they use `staleTrackerHint` alone.
 *
 * Note the timestamps come from different clocks — `lastRejectedAt` is the server's,
 * `waitingSince` is this browser's. Skew can only make this quieter or noisier by the
 * size of the skew, never wrong about which case it is; the alternative (asking the
 * server what time it thinks it is) buys accuracy nobody here needs.
 */
export function staleSinceWaiting(
  hint: StaleTrackerHintCopy | null,
  waitingSince: number | null,
): boolean {
  if (!hint || waitingSince === null) return false;
  const rejectedAt = Date.parse(hint.lastRejectedAt);
  return Number.isNaN(rejectedAt) ? false : rejectedAt > waitingSince;
}

export function installedNote(status: NoteStatus | null, ago: (iso: string) => string): InstalledNote | null {
  if (!status) return null;

  if (status.presence.status !== "offline") {
    return { lead: "Your account is already tracking." };
  }

  const seen = status.devices
    .filter((d) => d.lastUsedAt)
    .slice()
    .sort((a, b) => (a.lastUsedAt! < b.lastUsedAt! ? 1 : -1));
  const device = seen[0];
  if (!device) return null;

  return {
    lead: `Last tracked from ${device.label} · ${ago(device.lastUsedAt!)}.`,
    // "step 2", the Start step — an already-installed tracker that has gone quiet
    // needs starting, not reinstalling. Since round 10 the tracker re-reads its config
    // every tick and `start` replaces a daemon that is already running, so the old
    // "keeps its old settings until you stop and start it yourself" caveat was false
    // (round 12). Say what start does instead; it is the only command they need.
    detail: "Run step 2 again. Start replaces a tracker that is already running.",
  };
}

/* ---- which devices the Home panel may list ---- */

/**
 * Home lists devices so a *second machine* is visible; it shows the section only when
 * there is more than one. A token that was minted by opening the connect sheet but never
 * used — the person closed the sheet, or followed "Run step 2 again" and the old key
 * reconnected — is not a machine. Counting it grew a Devices section with a "never used"
 * row after a routine reconnect (round 14). Settings keeps every non-revoked token
 * because that is where Revoke lives; this rule is for Home only.
 */
export function homeDevices<T extends { lastUsedAt: string | null }>(devices: readonly T[]): T[] {
  return devices.filter((d) => d.lastUsedAt !== null);
}

/** Home shows the Devices section only for a real second machine. */
export function showHomeDevices(devices: readonly { lastUsedAt: string | null }[]): boolean {
  return homeDevices(devices).length > 1;
}

/**
 * The question asked before revoking a token that a machine has actually used. Short,
 * names the machine, says what stops and what it takes to come back — nothing about
 * "keys" or "tokens", which the person never saw. Never-used tokens are dropped without
 * asking, so this is only ever about a real device.
 */
export function revokePrompt(label: string): string {
  return `Revoke ${label}? Its tracker stops reporting until you install again.`;
}
