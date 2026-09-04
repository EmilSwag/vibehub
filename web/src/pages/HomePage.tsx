import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { friendsApi } from "../lib/api";
import { stagger } from "../lib/motion";
import type { Friend } from "../types";
import { Card } from "../components/ui/Card";
import { Avatar } from "../components/ui/Avatar";
import { StatusDot } from "../components/ui/StatusDot";
import buttonStyles from "../components/ui/Button.module.css";
import { ConnectTools } from "../components/ConnectTools";
import { FriendListItem } from "../components/FriendListItem";
import { Skeleton, SkeletonRow } from "../components/ui/Skeleton";
import { SectionTitle } from "../components/ui/SectionTitle";
import { elapsedShort, toolLabel } from "../lib/format";
import type { Presence } from "../types";
import styles from "./HomePage.module.css";

/** "vibehub · Claude Code · 12m" (active), "Idle · vibehub · Claude Code" (idle,
 * no duration — an idle session's elapsed time isn't the useful number), or a
 * bare "Not tracking" once the tracker itself is known to have nothing to say. */
function youLine(me: Presence | undefined): string {
  if (me?.status === "active") {
    return me.activity
      ? `${me.activity.projectAlias} · ${toolLabel(me.activity.tool)} · ${elapsedShort(me.activity.startedAt)}`
      : "Active";
  }
  if (me?.status === "idle") {
    return me.activity ? `Idle · ${me.activity.projectAlias} · ${toolLabel(me.activity.tool)}` : "Idle";
  }
  return "Not tracking";
}

export function HomePage() {
  const { user } = useAuth();
  const { presences, incomingRequests } = useRealtime();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    friendsApi
      .list()
      .then(({ friends }) => {
        if (active) setFriends(friends);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const activeFriends = friends.filter((f) => presences.get(f.user.username)?.status === "active");
  const me = user ? presences.get(user.username) : undefined;

  return (
    <div>
      <h1 className={styles.greeting}>Back at it, {user?.displayName}.</h1>
      <p className={styles.subtitle}>What your friends are shipping right now.</p>

      {/* Stays mounted regardless of connected state — it needs to notice an
          already-connected account on mount, not just a live flip, to fire the
          success modal (ConnectTools) reliably. Hides/shows itself. */}
      <ConnectTools variant="banner" />

      <div className={styles.grid}>
        <section>
          <SectionTitle icon="sparkles" count={activeFriends.length}>
            Live now
          </SectionTitle>
          <Card className={styles.card}>
            {loading ? (
              <SkeletonRow count={4} />
            ) : friends.length === 0 ? (
              <div className={styles.empty}>
                No friends yet — head to <Link to="/friends">Friends</Link> to add some.
              </div>
            ) : activeFriends.length === 0 ? (
              <div className={styles.empty}>Nobody's actively coding right now.</div>
            ) : (
              <div className="stagger">
                {activeFriends.map((f, i) => (
                  <div key={f.user.id} style={stagger(i)}>
                    <FriendListItem
                      user={f.user}
                      daysAsFriends={f.daysAsFriends}
                      presence={presences.get(f.user.username)}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>

        <aside className={styles.side}>
          {user && (
            <section>
              <SectionTitle icon="user">You</SectionTitle>
              <Card className={styles.youCard}>
                {loading ? (
                  <>
                    <Skeleton variant="circle" width={40} />
                    <div className={styles.youText}>
                      <Skeleton width="50%" height={13} style={{ marginBottom: 6 }} />
                      <Skeleton width="65%" height={12} />
                    </div>
                  </>
                ) : (
                  <>
                    <Avatar src={user.avatarUrl} name={user.displayName} size={40} />
                    <div className={styles.youText}>
                      <span className={styles.youName}>{user.displayName}</span>
                      <StatusDot status={me?.status ?? "offline"} label={youLine(me)} pulse={me?.status === "active"} />
                    </div>
                  </>
                )}
              </Card>
            </section>
          )}

          <section>
            <SectionTitle icon="inbox" count={incomingRequests.length} tone="hot">
              Friend requests
            </SectionTitle>
            <Card>
              {incomingRequests.length === 0 ? (
                <span className={styles.empty} style={{ padding: 0 }}>
                  No pending requests.
                </span>
              ) : (
                <>
                  <div className="stagger">
                    {incomingRequests.slice(0, 3).map((req, i) => (
                      <Link
                        key={req.id}
                        to="/friends"
                        className={styles.requestRow}
                        style={stagger(i)}
                      >
                        <Avatar src={req.sender?.avatarUrl} name={req.sender?.displayName ?? "?"} size={28} />
                        <span className={styles.requestName}>
                          {req.sender?.displayName ?? "Someone"}
                          <span className={styles.requestMeta}> @{req.sender?.username}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                  <Link
                    to="/friends"
                    className={[buttonStyles.btn, buttonStyles.secondary, styles.reviewBtn].join(" ")}
                  >
                    Review {incomingRequests.length > 3 ? `all ${incomingRequests.length}` : ""}
                  </Link>
                </>
              )}
            </Card>
          </section>

          <section>
            <SectionTitle icon="users" count={friends.length}>
              All friends
            </SectionTitle>
            <Card>
              {loading ? (
                <>
                  <Skeleton width="60%" height={13} style={{ marginBottom: 12 }} />
                  <Skeleton width="45%" height={13} style={{ marginBottom: 12 }} />
                  <Skeleton width="52%" height={13} />
                </>
              ) : friends.length === 0 ? (
                <span className={styles.empty} style={{ padding: 0 }}>
                  No friends yet.
                </span>
              ) : (
                friends.slice(0, 5).map((f) => (
                  <div key={f.user.id} style={{ marginBottom: 8 }}>
                    <Link to={`/u/${f.user.username}`} style={{ color: "var(--vh-text)", textDecoration: "none" }}>
                      {f.user.displayName}
                    </Link>
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
