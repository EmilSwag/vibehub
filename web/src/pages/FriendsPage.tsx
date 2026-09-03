import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useRealtime } from "../context/RealtimeContext";
import { ApiError, friendsApi, usersApi } from "../lib/api";
import { stagger } from "../lib/motion";
import type { Friend, FriendRequest, SuggestedUser } from "../types";
import { Card } from "../components/ui/Card";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { LevelBadge } from "../components/ui/LevelBadge";
import { SkeletonRow } from "../components/ui/Skeleton";
import { SectionTitle } from "../components/ui/SectionTitle";
import { rolesLabel } from "../components/ui/RoleGlyph";
import { FriendListItem } from "../components/FriendListItem";
import styles from "./FriendsPage.module.css";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/**
 * Friends — three things, in priority order: requests waiting on you, the
 * people you already vibe with, and a people finder (same rows as onboarding:
 * avatar · name · @user · role · Lvl · Invite).
 */
export function FriendsPage() {
  const { presences, incomingRequests, removeRequest, refreshRequests, pushToast } = useRealtime();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<SuggestedUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([friendsApi.list(), friendsApi.requests(), refreshRequests()])
      .then(([friendsRes, requestsRes]) => {
        setFriends(friendsRes.friends);
        setOutgoing(requestsRes.outgoing);
      })
      .finally(() => setLoading(false));
  }, [refreshRequests]);

  // People finder: debounced search; empty query = "people you may know".
  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const t = window.setTimeout(() => {
      usersApi
        .suggested(query.trim() || undefined, 20)
        .then(({ users }) => {
          if (!cancelled) setPeople(users);
        })
        .catch(() => {
          if (!cancelled) setPeople([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  async function invite(username: string) {
    setBusy(username);
    try {
      const { request } = await friendsApi.sendRequest(username);
      setOutgoing((prev) => [request, ...prev]);
      setInvited((prev) => new Set(prev).add(username));
    } catch (err) {
      pushToast({
        title: "Couldn't send invite",
        body: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  async function accept(req: FriendRequest) {
    setBusy(req.id);
    try {
      await friendsApi.acceptRequest(req.id);
      removeRequest(req.id);
      const { friends: list } = await friendsApi.list();
      setFriends(list);
      pushToast({
        title: `You and @${req.sender?.username ?? "them"} are now friends`,
        href: req.sender ? `/u/${req.sender.username}` : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  async function decline(req: FriendRequest) {
    setBusy(req.id);
    try {
      await friendsApi.declineRequest(req.id);
      removeRequest(req.id);
    } finally {
      setBusy(null);
    }
  }

  async function unfriend(username: string) {
    await friendsApi.unfriend(username);
    setFriends((prev) => prev.filter((f) => f.user.username !== username));
  }

  const pendingTo = new Set(outgoing.map((r) => r.receiver?.username).filter(Boolean));

  return (
    <div>
      <div className={styles.head}>
        <h1 className={styles.title}>Friends</h1>
        <span className={styles.count}>
          {friends.length} friend{friends.length === 1 ? "" : "s"}
        </span>
      </div>

      {incomingRequests.length > 0 && (
        <section className={cx(styles.section, "reveal")}>
          <SectionTitle icon="inbox" count={incomingRequests.length} tone="hot">
            Requests
          </SectionTitle>
          <Card className={cx(styles.card, styles.cardHot)}>
            <div className="stagger">
              {incomingRequests.map((req, i) => (
                <div className={styles.row} key={req.id} style={stagger(i)}>
                  <Link to={`/u/${req.sender?.username ?? ""}`} className={styles.rowIdentity}>
                    <Avatar src={req.sender?.avatarUrl} name={req.sender?.displayName ?? "?"} size={40} />
                    <span className={styles.rowText}>
                      <span className={styles.rowName}>{req.sender?.displayName ?? "Someone"}</span>
                      <span className={styles.rowMeta}>
                        @{req.sender?.username ?? req.senderId}
                        {rolesLabel(req.sender?.roles) && <> · {rolesLabel(req.sender?.roles)}</>}
                      </span>
                    </span>
                  </Link>
                  <div className={styles.rowActions}>
                    <Button size="sm" onClick={() => accept(req)} disabled={busy === req.id}>
                      Accept
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => decline(req)} disabled={busy === req.id}>
                      Decline
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      <div className={styles.grid}>
        <section className={styles.section}>
          <SectionTitle icon="users" count={friends.length}>
            Your people
          </SectionTitle>
          <Card className={styles.card}>
            {loading ? (
              <SkeletonRow count={5} />
            ) : friends.length === 0 ? (
              <button
                type="button"
                className={cx(styles.empty, styles.emptyLink)}
                onClick={() => searchRef.current?.focus()}
              >
                No friends yet. Invite someone from the finder →
              </button>
            ) : (
              <div className="stagger">
                {friends.map((f, i) => (
                  <div key={f.user.id} style={stagger(i)}>
                    <FriendListItem
                      user={f.user}
                      daysAsFriends={f.daysAsFriends}
                      presence={presences.get(f.user.username)}
                      action={
                        <button
                          type="button"
                          className={styles.unfriendBtn}
                          onClick={(e) => {
                            e.preventDefault();
                            void unfriend(f.user.username);
                          }}
                        >
                          Unfriend
                        </button>
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>

        <aside className={styles.side}>
          <section className={styles.section}>
            <SectionTitle icon="search">Find people</SectionTitle>
            <Card className={styles.card}>
              <div className={styles.search}>
                <svg
                  className={styles.searchIcon}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <Input
                  ref={searchRef}
                  className={styles.searchInput}
                  placeholder="Name or @username"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search people"
                />
              </div>

              {people === null || (searching && people.length === 0) ? (
                <SkeletonRow count={4} />
              ) : people.length === 0 ? (
                <div className={styles.empty}>
                  {query ? `Nobody matches “${query}”.` : "Everyone here is already your friend."}
                </div>
              ) : (
                <div className={cx("stagger", searching && styles.dim)}>
                  {people.map((u, i) => {
                    const sent = invited.has(u.username) || pendingTo.has(u.username);
                    return (
                      <div className={styles.row} key={u.id} style={stagger(i)}>
                        <Link to={`/u/${u.username}`} className={styles.rowIdentity}>
                          <Avatar src={u.avatarUrl} name={u.displayName} size={40} />
                          <span className={styles.rowText}>
                            <span className={styles.rowName}>{u.displayName}</span>
                            <span className={styles.rowMeta}>
                              @{u.username}
                              {rolesLabel(u.roles) && <> · {rolesLabel(u.roles)}</>}
                            </span>
                          </span>
                        </Link>
                        <LevelBadge level={u.level} size="sm" />
                        <Button
                          size="sm"
                          variant={sent ? "secondary" : "primary"}
                          onClick={() => invite(u.username)}
                          disabled={sent || busy === u.username}
                        >
                          {sent ? "Sent" : "Invite"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </section>

          {outgoing.length > 0 && (
            <section className={styles.section}>
              <SectionTitle icon="send" count={outgoing.length}>
                Sent
              </SectionTitle>
              <Card className={styles.card}>
                {outgoing.map((req) => (
                  <div className={styles.row} key={req.id}>
                    <Link to={`/u/${req.receiver?.username ?? ""}`} className={styles.rowIdentity}>
                      <Avatar src={req.receiver?.avatarUrl} name={req.receiver?.displayName ?? "?"} size={32} />
                      <span className={styles.rowText}>
                        <span className={styles.rowName}>{req.receiver?.displayName ?? req.receiverId}</span>
                        <span className={styles.rowMeta}>@{req.receiver?.username ?? ""}</span>
                      </span>
                    </Link>
                    <span className={styles.pending}>Pending</span>
                  </div>
                ))}
              </Card>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
