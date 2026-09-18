// WebSocket client per docs/ARCHITECTURE.md §5.9.
// Auth is the vh_session cookie read during the HTTP upgrade — browser only.
import type { WsServerEvent } from "../types";
import { ApiError, authApi } from "./api";
import { authGeneration, expireAuthSession, isCurrentAuth, onAuthBoundary } from "./authSession";

type Listener = (event: WsServerEvent) => void;

export class VibeHubSocket {
  private socket: WebSocket | null = null;
  private subscribed = new Set<string>();
  private listeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private closedByCaller = true;
  private lifecycle = 0;
  private generation = authGeneration();
  private probe: AbortController | null = null;
  private offAuth: (() => void) | null = null;

  constructor(private readonly userId: string) {}

  connect() {
    if (!this.closedByCaller) return;
    this.closedByCaller = false;
    this.generation = authGeneration();
    this.lifecycle += 1;
    this.reconnectAttempt = 0;
    this.offAuth = onAuthBoundary(() => this.close());
    this.open();
  }

  private active(lifecycle = this.lifecycle): boolean {
    return !this.closedByCaller && lifecycle === this.lifecycle && isCurrentAuth(this.generation);
  }

  private open() {
    if (!this.active()) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(import.meta.env.VITE_WS_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    const lifecycle = this.lifecycle;
    const current = () => this.active(lifecycle) && this.socket === socket;

    socket.addEventListener("open", () => {
      if (!current()) return;
      this.reconnectAttempt = 0;
      if (this.subscribed.size > 0) this.send([...this.subscribed]);
    });
    socket.addEventListener("message", (event) => {
      if (!current()) return;
      try {
        const data = JSON.parse(event.data) as WsServerEvent;
        this.listeners.forEach((listener) => listener(data));
      } catch {
        // ignore malformed frames
      }
    });
    socket.addEventListener("close", () => {
      if (!current()) return;
      this.socket = null;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (!this.active() || this.reconnectTimer !== null || this.probe) return;
    const lifecycle = this.lifecycle;
    const delay = Math.min(1000 * 2 ** Math.min(this.reconnectAttempt++, 4), 15000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.active(lifecycle)) void this.revalidate(lifecycle);
    }, delay);
  }

  private async revalidate(lifecycle: number) {
    const controller = new AbortController();
    this.probe = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    let authenticated = false;
    try {
      // Browsers do NOT expose handshake HTTP401 as CloseEvent.code (usually 1006).
      // Ask an authenticated HTTP endpoint instead; network/5xx/403 are inconclusive.
      const { user } = await authApi.me(controller.signal);
      if (!this.active(lifecycle)) return;
      if (!user || user.id !== this.userId) {
        expireAuthSession(this.generation);
        return;
      }
      authenticated = true;
    } catch (err) {
      // authApi.me() is sessionAuth:false (api.ts), so a 401 no longer expires the
      // session automatically — but this probe only ever runs for an already
      // signed-in socket (RealtimeContext never connects one for a guest), so a
      // real 401 here is exactly the same signal as the explicit `!user` branch
      // above. Anything else (network/5xx/403) stays inconclusive and just retries.
      if (err instanceof ApiError && err.status === 401) expireAuthSession(this.generation);
    } finally {
      clearTimeout(timeout);
      if (this.probe === controller) this.probe = null;
    }
    if (!this.active(lifecycle)) return;
    if (authenticated) this.open();
    else this.scheduleReconnect();
  }

  private send(channels: string[]) {
    if (this.active() && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "subscribe", channels }));
    }
  }

  // Additive per §5.9 (e.g. subscribing to a profile's wall while viewing it).
  subscribe(channels: string[]) {
    const newChannels = channels.filter((c) => !this.subscribed.has(c));
    if (newChannels.length === 0) return;
    newChannels.forEach((c) => this.subscribed.add(c));
    this.send(newChannels);
  }

  on(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.closedByCaller = true;
    this.lifecycle += 1;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.probe?.abort();
    this.probe = null;
    this.offAuth?.();
    this.offAuth = null;
    // Clear identity before close: even a synchronous/late close cannot schedule work.
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.subscribed.clear();
    this.listeners.clear();
  }
}
