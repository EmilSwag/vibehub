// WebSocket client per docs/ARCHITECTURE.md §5.9.
// Auth is the vh_session cookie read during the HTTP upgrade — browser only.

import type { WsServerEvent } from "../types";

type Listener = (event: WsServerEvent) => void;

export class VibeHubSocket {
  private socket: WebSocket | null = null;
  private subscribed = new Set<string>();
  private listeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private closedByCaller = false;

  connect() {
    this.closedByCaller = false;
    this.open();
  }

  private open() {
    const socket = new WebSocket(import.meta.env.VITE_WS_URL);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      if (this.subscribed.size > 0) {
        this.send([...this.subscribed]);
      }
    });

    socket.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data) as WsServerEvent;
        this.listeners.forEach((listener) => listener(data));
      } catch {
        // ignore malformed frames
      }
    });

    socket.addEventListener("close", () => {
      if (this.closedByCaller) return;
      const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 15000);
      this.reconnectAttempt += 1;
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    });
  }

  private send(channels: string[]) {
    if (this.socket?.readyState === WebSocket.OPEN) {
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    this.subscribed.clear();
  }
}
