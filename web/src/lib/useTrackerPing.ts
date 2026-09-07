import { useCallback, useEffect, useRef, useState } from "react";
import { usersApi } from "./api";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import type { TrackerStatus } from "../types";

/**
 * Watches for the tracker's first ping while the connect sheet is open.
 *
 * The only thing in the app that knows what "a ping" is, so the sheet can be pure UI.
 * Two signals feed it: a 3s poll of `/users/me/tracker` while the sheet is open and
 * the tab is visible, and the realtime presence push for the viewer, which usually
 * beats the next poll.
 */

/** The furthest step reached, in order. "Copied" is the sheet's own business — it
 *  knows when the button was pressed — so it is not a stage here. */
export type PingStage = "idle" | "waiting" | "pinged" | "live";

export interface TrackerPing {
  stage: PingStage;
  /** Since `started` went true. 0 while idle. */
  elapsedMs: number;
  /** Nothing has arrived in 90 seconds. Reason to offer help, never an error. */
  stalled: boolean;
  /** Label of the device that pinged, once one has. */
  device: string | null;
  /** Raw tool id the first ping reported, if it reported one. */
  tool: string | null;
  /** Latest status, for the caller that wants to hand it to the celebration. */
  status: TrackerStatus | null;
  /** Tracking was already live when the sheet opened — nothing was waited for, so
   *  there is nothing to celebrate and nothing to close. The step list just rests in
   *  its finished state (the `/?connect=1` deep link lands here). */
  liveAtOpen: boolean;
}

const POLL_MS = 3_000;
export const STALLED_AFTER_MS = 90_000;

const newer = (a: string | null, b: string | null) => a !== null && (b === null || a > b);

export function useTrackerPing(open: boolean, started: boolean): TrackerPing {
  const { user } = useAuth();
  const { presences } = useRealtime();

  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // What "already pinged" looked like before this attempt. An account that is merely
  // offline pinged at some point yesterday; without a baseline it would jump straight
  // to "first ping received" and show a stale device.
  const baseline = useRef<string | null>(null);
  const baselineSet = useRef(false);
  const [liveAtOpen, setLiveAtOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await usersApi.trackerStatus();
      if (!baselineSet.current) {
        baseline.current = next.lastSeenAt;
        baselineSet.current = true;
        setLiveAtOpen(next.presence.status === "active");
      }
      setStatus(next);
    } catch {
      /* transient — keep the last known state, the next tick will retry */
    }
  }, []);

  // A fresh open is a fresh attempt: re-baseline, drop the timer.
  useEffect(() => {
    if (open) return;
    baselineSet.current = false;
    baseline.current = null;
    setLiveAtOpen(false);
    setStartedAt(null);
    setElapsedMs(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  // 3s while open and visible. A background tab is not watching the sheet, and the
  // poll would keep the server busy for nobody.
  useEffect(() => {
    if (!open) return;
    let id: number | undefined;
    const stop = () => {
      if (id !== undefined) window.clearInterval(id);
      id = undefined;
    };
    const sync = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      void refresh();
      id = window.setInterval(() => void refresh(), POLL_MS);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [open, refresh]);

  // The realtime push lands before the next poll would. Merge the status word at once,
  // then pull the full record for the device and tool names.
  const me = user ? presences.get(user.username) : undefined;
  useEffect(() => {
    if (!open || !me) return;
    setStatus((prev) =>
      prev
        ? { ...prev, connected: me.status !== "offline", presence: { ...prev.presence, status: me.status, activity: me.activity } }
        : prev,
    );
    void refresh();
  }, [open, me, refresh]);

  useEffect(() => {
    if (!started) return;
    setStartedAt((current) => current ?? Date.now());
  }, [started]);

  // One tick a second — the elapsed readout is mm:ss and nothing finer is shown.
  useEffect(() => {
    if (startedAt === null) return;
    setElapsedMs(Date.now() - startedAt);
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 1_000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const pinged = status !== null && newer(status.lastSeenAt, baseline.current);
  const live = status?.presence.status === "active";

  // Already-live counts as started: the deep link opens the sheet on an account that
  // never had anything to wait for, and an empty step 2 would read as "nothing works".
  const stage: PingStage = !started && !liveAtOpen ? "idle" : live ? "live" : pinged ? "pinged" : "waiting";

  // The device that just pinged is the most recently used one; before round 7 servers
  // sent no dates at all, and then there is simply no name to show.
  const device =
    pinged && status
      ? (status.devices
          .filter((d) => d.lastUsedAt)
          .sort((a, b) => (a.lastUsedAt! < b.lastUsedAt! ? 1 : -1))[0]?.label ?? null)
      : null;
  const tool = pinged && status ? (status.sources[0]?.tool ?? status.tools[0] ?? null) : null;

  return {
    stage,
    elapsedMs: startedAt === null ? 0 : elapsedMs,
    stalled: stage === "waiting" && elapsedMs >= STALLED_AFTER_MS,
    device,
    tool,
    status,
    liveAtOpen,
  };
}

/** "00:42", "02:07" — fixed width, so the row never reflows as it ticks. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
