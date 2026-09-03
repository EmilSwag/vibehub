import type { WebSocket } from "ws";
import { friendIdsOf } from "../lib/friends";
import type { PresenceSnapshot } from "../lib/sessions";

// Per-user socket registry + per-socket channel subscriptions (ARCHITECTURE.md §5.9).
// Channels: "presence", "friend-requests", "wall:{username}".

export interface WsClient {
  socket: WebSocket;
  userId: string;
  username: string;
  channels: Set<string>;
}

const clients = new Set<WsClient>();

export function addClient(client: WsClient): void {
  clients.add(client);
}

export function removeClient(client: WsClient): void {
  clients.delete(client);
}

export function subscribe(client: WsClient, channels: string[]): void {
  for (const channel of channels) {
    if (typeof channel === "string" && channel.length <= 64) client.channels.add(channel);
  }
}

export function connectedUserIds(): Set<string> {
  return new Set([...clients].map((c) => c.userId));
}

function send(client: WsClient, event: unknown): void {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(event));
  }
}

export function sendToUser(userId: string, channel: string, event: unknown): void {
  for (const client of clients) {
    if (client.userId === userId && client.channels.has(channel)) send(client, event);
  }
}

export function broadcastToChannel(channel: string, event: unknown): void {
  for (const client of clients) {
    if (client.channels.has(channel)) send(client, event);
  }
}

// ---- Typed emitters wired into routes/jobs ----

export async function emitPresenceUpdate(userId: string, presence: PresenceSnapshot): Promise<void> {
  const event = { type: "presence:update", ...presence };
  const recipients = new Set(await friendIdsOf(userId));
  recipients.add(userId); // the user sees their own status too
  for (const recipient of recipients) sendToUser(recipient, "presence", event);
}

export function emitWallComment(wallOwnerUsername: string, comment: unknown): void {
  broadcastToChannel(`wall:${wallOwnerUsername}`, {
    type: "wall:new-comment",
    wallOwner: wallOwnerUsername,
    comment,
  });
}

export function emitFriendRequest(receiverId: string, request: unknown): void {
  sendToUser(receiverId, "friend-requests", { type: "friend-request:incoming", request });
}
