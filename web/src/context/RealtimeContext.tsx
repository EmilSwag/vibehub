import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { VibeHubSocket } from "../lib/ws";
import { useAuth } from "./AuthContext";
import type { FriendRequest, Presence, WallComment } from "../types";

interface RealtimeContextValue {
  presences: Map<string, Presence>;
  incomingRequests: FriendRequest[];
  watchWall: (username: string, onComment: (comment: WallComment) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const socketRef = useRef<VibeHubSocket | null>(null);
  const [presences, setPresences] = useState<Map<string, Presence>>(new Map());
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const wallListenersRef = useRef<Map<string, Set<(comment: WallComment) => void>>>(new Map());

  useEffect(() => {
    if (!user) {
      socketRef.current?.close();
      socketRef.current = null;
      setPresences(new Map());
      return;
    }

    const socket = new VibeHubSocket();
    socketRef.current = socket;
    socket.connect();
    socket.subscribe(["presence", "friend-requests"]);

    const unsubscribe = socket.on((event) => {
      if (event.type === "presence:update") {
        setPresences((prev) => {
          const next = new Map(prev);
          next.set(event.username, {
            username: event.username,
            status: event.status,
            activity: event.activity,
          });
          return next;
        });
      } else if (event.type === "friend-request:incoming") {
        setIncomingRequests((prev) => [event.request, ...prev]);
      } else if (event.type === "wall:new-comment") {
        wallListenersRef.current.get(event.wallOwner)?.forEach((cb) => cb(event.comment));
      }
    });

    return () => {
      unsubscribe();
      socket.close();
      socketRef.current = null;
    };
  }, [user]);

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
    () => ({ presences, incomingRequests, watchWall }),
    [presences, incomingRequests, watchWall]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime must be used within RealtimeProvider");
  return ctx;
}
