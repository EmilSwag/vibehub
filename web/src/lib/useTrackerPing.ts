import { useEffect, useRef, useState } from "react";
import { usersApi } from "./api";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import type { TrackerStatus } from "../types";
import { connectionAlive, freshPing, observePing, pingStage, sessionKeyOf, visibleSnapshot } from "./trackerPing";
import type { PingObservation, PingStage } from "./trackerPing";

export type { PingStage } from "./trackerPing";

export interface TrackerPing {
  stage: PingStage;
  elapsedMs: number;
  stalled: boolean;
  device: string | null;
  tool: string | null;
  /** Only evidence fetched for the current open and account. */
  status: TrackerStatus | null;
  /** An existing connection is not a new connection to celebrate. */
  liveAtOpen: boolean;
  /**
   * When this attempt started waiting (epoch ms), or null if it has not. The sheet
   * compares server timestamps against it to tell "this is happening now" from "this
   * happened at some point today" — see staleSinceWaiting in trackerPing.ts.
   */
  waitingSince: number | null;
}

const POLL_MS = 3_000;
export const STALLED_AFTER_MS = 90_000;

/**
 * The sheet observes server pings; it cannot start or inspect a local process.
 * Each open/account owns its snapshot, baseline and initial-live flag together.
 * Requests are single-flight so an older response cannot overwrite a newer one.
 */
export function useTrackerPing(open: boolean, started: boolean): TrackerPing {
  const { user } = useAuth();
  const { presences } = useRealtime();
  const userId = user?.id ?? null;

  // Adjust during render, so no previous session's state is exposed before effects.
  const [session, setSession] = useState(0);
  const [sessionKey, setSessionKey] = useState(() => sessionKeyOf(open, userId));
  const currentKey = sessionKeyOf(open, userId);
  if (sessionKey !== currentKey) {
    setSessionKey(currentKey);
    setSession((n) => n + 1);
  }

  const [snap, setSnap] = useState<{
    session: number;
    status: PingObservation<TrackerStatus>;
  } | null>(null);
  const [wait, setWait] = useState<{ session: number; at: number } | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const observation = open && userId ? visibleSnapshot(snap, session) : null;
  const status = observation?.tracker ?? null;
  const liveAtOpen = observation?.liveAtOpen ?? false;
  const startedAt = open && started && wait?.session === session ? wait.at : null;
  const pull = useRef<() => void>(() => {});

  useEffect(() => {
    if (!open || !userId) return;
    const mySession = session;
    let alive = true;
    let inFlight = false;
    let pending = false;
    let id: number | undefined;

    const fetchOnce = async () => {
      if (!alive) return;
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      try {
        const next = await usersApi.trackerStatus();
        if (!alive) return;
        setSnap((previous) => {
          if (!alive || (previous !== null && previous.session > mySession)) return previous;
          return {
            session: mySession,
            status: observePing(visibleSnapshot(previous, mySession), next),
          };
        });
      } catch {
        // A transient failure is not proof of a new connection. Retry on the next poll.
      } finally {
        inFlight = false;
        if (alive && pending) {
          pending = false;
          void fetchOnce();
        }
      }
    };

    pull.current = () => void fetchOnce();
    const stop = () => {
      if (id !== undefined) window.clearInterval(id);
      id = undefined;
    };
    const sync = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      void fetchOnce();
      id = window.setInterval(() => void fetchOnce(), POLL_MS);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      alive = false;
      pending = false;
      pull.current = () => {};
      stop();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [open, userId, session]);

  // Realtime prompts a full fresh read, not a merge of a new status word with an
  // old timestamp. Opening already performs a read; do not duplicate that request.
  const me = user ? presences.get(user.username) : undefined;
  const lastPresence = useRef(me);
  useEffect(() => {
    const changed = lastPresence.current !== me;
    lastPresence.current = me;
    if (open && userId && me && changed) pull.current();
  }, [open, userId, me]);

  useEffect(() => {
    if (!open || !userId || !started) {
      setWait(null);
      return;
    }
    setWait((current) => current?.session === session ? current : { session, at: Date.now() });
  }, [open, userId, started, session]);

  useEffect(() => {
    if (startedAt === null) {
      setElapsedMs(0);
      return;
    }
    const tick = () => setElapsedMs(Date.now() - startedAt);
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const inputs = {
    started: open && userId !== null && started,
    liveAtOpen,
    baselineReady: observation !== null,
    baselineAt: observation?.baselineAt ?? null,
    hasSnapshot: status !== null,
    lastSeenAt: status?.lastSeenAt ?? null,
    presenceActive: connectionAlive(status),
  };
  const pinged = freshPing(inputs);
  const stage = pingStage(inputs);
  const device = pinged && status
    ? status.devices
        .filter((d) => d.lastUsedAt)
        .sort((a, b) => (a.lastUsedAt! < b.lastUsedAt! ? 1 : -1))[0]?.label ?? null
    : null;
  const tool = pinged && status ? status.sources[0]?.tool ?? status.tools[0] ?? null : null;

  return {
    stage,
    elapsedMs: startedAt === null ? 0 : elapsedMs,
    stalled: stage === "waiting" && elapsedMs >= STALLED_AFTER_MS,
    device,
    tool,
    status,
    liveAtOpen,
    waitingSince: startedAt,
  };
}

/** "00:42", "02:07" — fixed width, so the row never reflows as it ticks. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
