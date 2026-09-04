import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { friendsApi } from "../lib/api";
import { stagger } from "../lib/motion";
import type { Friend } from "../types";
import { Card } from "../components/ui/Card";
import { Avatar } from "../components/ui/Avatar";
import { PresenceBlock } from "../components/ui/PresenceBlock";
import { StatusDot } from "../components/ui/StatusDot";
import buttonStyles from "../components/ui/Button.module.css";
import { ConnectTools } from "../components/ConnectTools";
import { FriendListItem, FriendListItemSkeleton } from "../components/FriendListItem";
import { Skeleton } from "../components/ui/Skeleton";
import { SectionTitle } from "../components/ui/SectionTitle";
import styles from "./HomePage.module.css";

/** Rows shown under "All friends" before the "All N friends" link takes over. */
const ALL_FRIENDS_MAX = 5;

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

  return (
    <div>
      <h1 className={styles.greeting}>Back at it, {user?.displayName}.</h1>
      <p className={styles.subtitle}>What your friends are shipping right now.</p>

      {/* Stays mounted regardless of connected state — it needs to notice an
          already-connected account on mount, not just a live flip, to fire the
          success modal (ConnectTools) reliably. Hides/shows itself. */}
      <ConnectTools variant="banner" />

      <div className={styles.grid}>
        <section className={styles.section}>
          <SectionTitle icon="sparkles" count={activeFriends.length}>
            Live now
          </SectionTitle>
          <Card className={styles.listCard}>
            {loading ? (
              <FriendListItemSkeleton count={3} live />
            ) : friends.length === 0 ? (
              <div className={styles.empty}>
                No friends yet — head to <Link to="/friends">Friends</Link> to add some.
              </div>
            ) : activeFriends.length === 0 ? (
              <div className={styles.empty}>Nobody's actively coding right now.</div>
            ) : (
              <div className="stagger">
                {activeFriends.map((f, i) => (
                  <FriendListItem
                    key={f.user.id}
                    index={i}
                    user={f.user}
                    daysAsFriends={f.daysAsFriends}
                    presence={presences.get(f.user.username)}
                  />
                ))}
              </div>
            )}
          </Card>
        </section>

        <aside className={styles.side}>
          <section className={styles.section}>
            <SectionTitle icon="inbox" count={incomingRequests.length} tone="hot">
              Friend requests
            </SectionTitle>
            <Card>
              {incomingRequests.length === 0 ? (
                <span className={styles.emptyInline}>No pending requests.</span>
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

          <section className={styles.section}>
            <SectionTitle icon="users" count={friends.length}>
              All friends
            </SectionTitle>
            <Card className={styles.listCard}>
              {loading ? (
                <div className="stagger" aria-hidden="true">
                  {Array.from({ length: 3 }, (_, i) => (
                    <div key={i} className={styles.friendRow} style={stagger(i)}>
                      <Skeleton variant="circle" width={32} />
                      <Skeleton width="46%" height={13} />
                      <Skeleton variant="circle" width={8} className={styles.friendDot} />
                    </div>
                  ))}
                </div>
              ) : friends.length === 0 ? (
                <div className={styles.empty}>No friends yet.</div>
              ) : (
                <>
                  {friends.slice(0, ALL_FRIENDS_MAX).map((f) => {
                    const presence = presences.get(f.user.username);
                    const live = presence !== undefined && presence.status !== "offline";
                    return (
                      <Link key={f.user.id} to={`/u/${f.user.username}`} className={styles.friendRow}>
                        <Avatar src={f.user.avatarUrl} name={f.user.displayName} size={32} />
                        <span className={styles.friendName}>
                          {f.user.displayName}
                          <span className={styles.friendHandle}> @{f.user.username}</span>
                        </span>
                        {live ? (
                          <PresenceBlock
                            presence={presence}
                            variant="compact"
                            showElapsed={false}
                            className={styles.friendPresence}
                          />
                        ) : (
                          <StatusDot status="offline" className={styles.friendDot} />
                        )}
                      </Link>
                    );
                  })}
                  {friends.length > ALL_FRIENDS_MAX && (
                    <Link to="/friends" className={styles.moreLink}>
                      All {friends.length} friends
                    </Link>
                  )}
                </>
              )}
            </Card>
          </section>
        </aside>
      </div>
    </div>
  );
}
