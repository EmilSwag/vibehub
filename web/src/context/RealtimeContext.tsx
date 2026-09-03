import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { friendsApi, presenceApi } from "../lib/api";
import { VibeHubSocket } from "../lib/ws";
import { ToastStack } from "../components/ui/Toast";
import { useAuth } from "./AuthContext";
import type { FriendRequest, Presence, WallComment } from "../types";

export interface Toast {
  id: string;
  title: string;
  body?: string;
  /** Optional in-app link (e.g. "/friends"). */
  href?: string;
}

interface RealtimeContextValue {
  presences: Map<string, Presence>;
  incomingRequests: FriendRequest[];
  /** Drop a request from the badge/list after accept/decline. */
  removeRequest: (id: string) => void;
  /** Re-pull the pending list (after sending/accepting from another tab, etc). */
  refreshRequests: () => Promise<void>;
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  watchWall: (username: string, onComment: (comment: WallComment) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

const TOAST_TTL_MS = 6000;
/** Don't announce the same friend going live more than once per 10 minutes. */
const LIVE_TOAST_COOLDOWN_MS = 10 * 60 * 1000;

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const socketRef = useRef<VibeHubSocket | null>(null);
  const [presences, setPresences] = useState<Map<string, Presence>>(new Map());
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const wallListenersRef = useRef<Map<string, Set<(comment: WallComment) => void>>>(new Map());
  const liveToastAtRef = useRef<Map<string, number>>(new Map());
  // Mirror of `presences` for the socket handler (avoids side effects in updaters).
  const presencesRef = useRef<Map<string, Presence>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismissToast(id), TOAST_TTL_MS);
    },
    [dismissToast]
  );

  const refreshRequests = useCallback(async () => {
    try {
      const { incoming } = await friendsApi.requests();
      setIncomingRequests(incoming);
    } catch {
      /* keep what we have */
    }
  }, []);

  const removeRequest = useCallback((id: string) => {
    setIncomingRequests((prev) => prev.filter((r) => r.id !== id));
  }, []);

  useEffect(() => {
    if (!user) {
      socketRef.current?.close();
      socketRef.current = null;
      presencesRef.current = new Map();
      setPresences(new Map());
      setIncomingRequests([]);
      return;
    }

    // Initial snapshot — the socket only pushes *changes*, so without this the
    // header badge and "Live now" stay empty until something happens.
    let cancelled = false;
    presenceApi
      .friends()
      .then(({ presences: list }) => {
        if (cancelled) return;
        // Merge: live pushes may already have arrived while the snapshot was in flight.
        const merged = new Map(list.map((p) => [p.username, p] as const));
        presencesRef.current.forEach((p, k) => merged.set(k, p));
        presencesRef.current = merged;
        setPresences(merged);
      })
      .catch(() => undefined);
    void refreshRequests();

    const socket = new VibeHubSocket();
    socketRef.current = socket;
    socket.connect();
    socket.subscribe(["presence", "friend-requests"]);

    const unsubscribe = socket.on((event) => {
      if (event.type === "presence:update") {
        const before = presencesRef.current.get(event.username);
        const next = new Map(presencesRef.current);
        next.set(event.username, {
          username: event.username,
          status: event.status,
          activity: event.activity,
        });
        presencesRef.current = next;
        setPresences(next);

        // Steam-style "friend is now playing" — only on offline/idle → active.
        const wentLive =
          event.username !== user.username &&
          event.status === "active" &&
          before?.status !== "active";
        if (wentLive) {
          const last = liveToastAtRef.current.get(event.username) ?? 0;
          if (Date.now() - last > LIVE_TOAST_COOLDOWN_MS) {
            liveToastAtRef.current.set(event.username, Date.now());
            pushToast({
              title: `@${event.username} is live`,
              body: event.activity ? `Vibing in ${event.activity.projectAlias}` : undefined,
              href: `/u/${event.username}`,
            });
          }
        }
      } else if (event.type === "friend-request:incoming") {
        setIncomingRequests((prev) =>
          prev.some((r) => r.id === event.request.id) ? prev : [event.request, ...prev]
        );
        const from = event.request.sender?.username;
        pushToast({
          title: "New friend request",
          body: from ? `@${from} wants to add you` : undefined,
          href: "/friends",
        });
      } else if (event.type === "wall:new-comment") {
        wallListenersRef.current.get(event.wallOwner)?.forEach((cb) => cb(event.comment));
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
      socket.close();
      socketRef.current = null;
    };
  }, [user, pushToast, refreshRequests]);

  const watchWall = useMemo(
    () => (username: string, onComment: (comment: WallComment) => void) => {
      socketRef.current?.subscribe([`wall:${username}`]);
      let set = wallListenersRef.current.get(username);
      if (!set) {
        set = new Set();
        wallListenersRef.current.set(username, set);
      }
      set.add(onComment);
      return () => {
        set?.delete(onComment);
      };
    },
    []
  );

  const value = useMemo(
    () => ({
      presences,
      incomingRequests,
      removeRequest,
      refreshRequests,
      toasts,
      pushToast,
      dismissToast,
      watchWall,
    }),
    [presences, incomingRequests, removeRequest, refreshRequests, toasts, pushToast, dismissToast, watchWall]
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime must be used within RealtimeProvider");
  return ctx;
}
