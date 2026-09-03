import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { friendsApi, usersApi } from "../lib/api";
import { stagger, useExitTransition } from "../lib/motion";
import type { Friend, TrackerStatus } from "../types";
import { Card } from "../components/ui/Card";
import { Avatar } from "../components/ui/Avatar";
import buttonStyles from "../components/ui/Button.module.css";
import { ConnectTools } from "../components/ConnectTools";
import { FriendListItem } from "../components/FriendListItem";
import { Skeleton, SkeletonRow } from "../components/ui/Skeleton";
import { SectionTitle } from "../components/ui/SectionTitle";
import styles from "./HomePage.module.css";

export function HomePage() {
  const { user } = useAuth();
  const { presences, incomingRequests } = useRealtime();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [tracker, setTracker] = useState<TrackerStatus | null>(null);

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
    usersApi
      .trackerStatus()
      .then((s) => {
        if (active) setTracker(s);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const activeFriends = friends.filter((f) => presences.get(f.user.username)?.status === "active");
  const me = user ? presences.get(user.username) : undefined;

  // Until the tracker reports, the profile is empty — keep offering the fix.
  // Kept mounted a beat past "connected" so the banner fades out instead of vanishing.
  const showBanner = !!tracker && !tracker.connected;
  const { render: renderBanner, closing: bannerClosing } = useExitTransition(showBanner, 260);

  return (
    <div>
      <h1 className={styles.greeting}>Back at it, {user?.displayName}.</h1>
      <p className={styles.subtitle}>What your friends are shipping right now.</p>

      {renderBanner && (
        <div className={[styles.banner, bannerClosing ? "leave" : "reveal"].join(" ")}>
          <ConnectTools onConnected={() => setTracker((t) => (t ? { ...t, connected: true } : t))} />
        </div>
      )}

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
                <Avatar src={user.avatarUrl} name={user.displayName} size={40} />
                <div className={styles.youText}>
                  <span className={styles.youName}>{user.displayName}</span>
                  <span className={styles.youStatus}>
                    {me?.status === "active" && me.activity
                      ? `Vibing in ${me.activity.projectAlias}`
                      : me?.status === "active"
                        ? "Active"
                        : me?.status === "idle"
                          ? "Idle"
                          : tracker?.connected
                            ? "Offline · tracker connected"
                            : "Offline · tracker not connected"}
                  </span>
                </div>
                <span
                  className={[styles.youDot, me?.status === "active" && styles.youDotLive]
                    .filter(Boolean)
                    .join(" ")}
                  aria-hidden="true"
                />
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
                  —
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
