import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { friendsApi } from "../lib/api";
import type { Friend } from "../types";
import { Card } from "../components/ui/Card";
import buttonStyles from "../components/ui/Button.module.css";
import { FriendListItem } from "../components/FriendListItem";
import { Skeleton, SkeletonRow } from "../components/ui/Skeleton";
import styles from "./HomePage.module.css";

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
      <p className={styles.subtitle}>Here's what your friends are shipping right now.</p>

      <div className={styles.grid}>
        <section>
          <h2 className={styles.sectionTitle}>
            Live now {activeFriends.length > 0 && `· ${activeFriends.length}`}
          </h2>
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
                  <div key={f.user.id} style={{ "--i": i } as CSSProperties}>
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
          <section>
            <h2 className={styles.sectionTitle}>Friend requests</h2>
            <Card>
              {incomingRequests.length === 0 ? (
                <span className={styles.empty} style={{ padding: 0 }}>
                  No pending requests.
                </span>
              ) : (
                <>
                  <div className={styles.requestRow}>
                    <span>{incomingRequests.length} pending</span>
                  </div>
                  <Link to="/friends" className={[buttonStyles.btn, buttonStyles.secondary].join(" ")}>
                    Review
                  </Link>
                </>
              )}
            </Card>
          </section>

          <section>
            <h2 className={styles.sectionTitle}>All friends</h2>
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
