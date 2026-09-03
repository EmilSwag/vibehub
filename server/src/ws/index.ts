import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "../auth/jwt";
import { resolveSessionUser } from "../middleware/auth";
import { addClient, removeClient, subscribe } from "./hub";
import type { WsClient } from "./hub";

// WebSocket endpoint at /ws — auth via the vh_session cookie during the HTTP upgrade
// (browser only; the tracker never opens a socket). Contract: ARCHITECTURE.md §5.9.

const PING_INTERVAL_MS = 30_000;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function rejectUpgrade(socket: NodeJS.WritableStream & { destroy(): void }, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function attachWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/ws") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    resolveSessionUser(parseCookies(req.headers.cookie)[SESSION_COOKIE])
      .then((user) => {
        if (!user) {
          rejectUpgrade(socket, 401, "Unauthorized");
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req, { userId: user.id, username: user.username });
        });
      })
      .catch(() => rejectUpgrade(socket, 500, "Internal Server Error"));
  });

  wss.on(
    "connection",
    (ws: WebSocket, _req: IncomingMessage, identity: { userId: string; username: string }) => {
      const client: WsClient = { socket: ws, ...identity, channels: new Set() };
      addClient(client);

      let alive = true;
      ws.on("pong", () => {
        alive = true;
      });
      const ping = setInterval(() => {
        if (!alive) {
          ws.terminate();
          return;
        }
        alive = false;
        ws.ping();
      }, PING_INTERVAL_MS);

      ws.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as { type?: string; channels?: unknown };
          if (message.type === "subscribe" && Array.isArray(message.channels)) {
            subscribe(client, message.channels.filter((c): c is string => typeof c === "string"));
          }
        } catch {
          // ignore malformed frames
        }
      });

      ws.on("close", () => {
        clearInterval(ping);
        removeClient(client);
      });
      ws.on("error", () => {
        clearInterval(ping);
        removeClient(client);
      });
    }
  );

  return wss;
}
