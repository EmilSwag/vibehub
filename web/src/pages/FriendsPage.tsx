import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRealtime } from "../context/RealtimeContext";
import { ApiError, friendsApi } from "../lib/api";
import type { Friend, FriendRequest } from "../types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { FriendListItem } from "../components/FriendListItem";
import styles from "./FriendsPage.module.css";

export function FriendsPage() {
  const { presences, incomingRequests: liveIncoming } = useRealtime();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [targetUsername, setTargetUsername] = useState("");
  const [addMessage, setAddMessage] = useState<{ text: string; error: boolean } | null>(null);

  const loadAll = () => {
    friendsApi.list().then(({ friends }) => setFriends(friends));
    friendsApi.requests().then(({ incoming, outgoing }) => {
      setIncoming(incoming);
      setOutgoing(outgoing);
    });
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([friendsApi.list(), friendsApi.requests()])
      .then(([friendsRes, requestsRes]) => {
        setFriends(friendsRes.friends);
        setIncoming(requestsRes.incoming);
        setOutgoing(requestsRes.outgoing);
      })
      .finally(() => setLoading(false));
  }, []);

  // merge realtime friend-request pushes into the incoming list
  useEffect(() => {
    if (liveIncoming.length === 0) return;
    setIncoming((prev) => {
      const ids = new Set(prev.map((r) => r.id));
      const fresh = liveIncoming.filter((r) => !ids.has(r.id));
      return fresh.length > 0 ? [...fresh, ...prev] : prev;
    });
  }, [liveIncoming]);

  async function handleAddFriend(event: FormEvent) {
    event.preventDefault();
    setAddMessage(null);
    try {
      const { request } = await friendsApi.sendRequest(targetUsername.trim());
      setOutgoing((prev) => [request, ...prev]);
      setTargetUsername("");
      setAddMessage({ text: "Friend request sent.", error: false });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not send request";
      setAddMessage({ text: msg, error: true });
    }
  }

  async function handleAccept(id: string) {
    await friendsApi.acceptRequest(id);
    setIncoming((prev) => prev.filter((r) => r.id !== id));
    loadAll();
  }

  async function handleDecline(id: string) {
    await friendsApi.declineRequest(id);
    setIncoming((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleUnfriend(username: string) {
    await friendsApi.unfriend(username);
    setFriends((prev) => prev.filter((f) => f.user.username !== username));
  }

  return (
    <div>
      <h1 className={styles.title}>Friends</h1>

      <div className={styles.grid}>
        <section>
          <h2 className={styles.sectionTitle}>
            {friends.length} friend{friends.length === 1 ? "" : "s"}
          </h2>
          <Card className={styles.card}>
            {loading ? (
              <div className={styles.empty}>Loading…</div>
            ) : friends.length === 0 ? (
              <div className={styles.empty}>No friends yet — add one from the panel on the right.</div>
            ) : (
              friends.map((f) => (
                <FriendListItem
                  key={f.user.id}
                  user={f.user}
                  daysAsFriends={f.daysAsFriends}
                  presence={presences.get(f.user.username)}
                  action={
                    <button
                      type="button"
                      className={styles.unfriendBtn}
                      onClick={(e) => {
                        e.preventDefault();
                        handleUnfriend(f.user.username);
                      }}
                    >
                      unfriend
                    </button>
                  }
                />
              ))
            )}
          </Card>
        </section>

        <aside className={styles.side}>
          <section>
            <h2 className={styles.sectionTitle}>Add a friend</h2>
            <Card>
              <form className={styles.addForm} onSubmit={handleAddFriend}>
                <Input
                  placeholder="username"
                  value={targetUsername}
                  onChange={(e) => setTargetUsername(e.target.value)}
                  required
                />
                <Button type="submit" disabled={!targetUsername.trim()}>
                  Send
                </Button>
              </form>
              {addMessage && (
                <p
                  className={styles.formMessage}
                  style={{ color: addMessage.error ? "var(--vh-accent-hover)" : "var(--vh-text-dim)" }}
                >
                  {addMessage.text}
                </p>
              )}
            </Card>
          </section>

          <section>
            <h2 className={styles.sectionTitle}>Incoming requests</h2>
            <Card className={styles.card}>
              {incoming.length === 0 ? (
                <div className={styles.empty}>Nothing pending.</div>
              ) : (
                incoming.map((req) => (
                  <div className={styles.requestRow} key={req.id}>
                    <span className={styles.requestName}>{req.sender?.displayName ?? req.senderId}</span>
                    <div className={styles.requestActions}>
                      <Button variant="secondary" onClick={() => handleAccept(req.id)}>
                        Accept
                      </Button>
                      <Button variant="ghost" onClick={() => handleDecline(req.id)}>
                        Decline
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </Card>
          </section>

          <section>
            <h2 className={styles.sectionTitle}>Outgoing requests</h2>
            <Card className={styles.card}>
              {outgoing.length === 0 ? (
                <div className={styles.empty}>Nothing pending.</div>
              ) : (
                outgoing.map((req) => (
                  <div className={styles.requestRow} key={req.id}>
                    <span className={styles.requestName}>{req.receiver?.displayName ?? req.receiverId}</span>
                    <span style={{ color: "var(--vh-text-faint)", fontSize: 12 }}>pending</span>
                  </div>
                ))
              )}
            </Card>
          </section>
        </aside>
      </div>
    </div>
  );
}
