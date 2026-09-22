import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { friendsApi } from "../lib/api";
import { stagger } from "../lib/motion";
import type { Friend } from "../types";
import { Card } from "../components/ui/Card";
import { Avatar } from "../components/ui/Avatar";
import { PresenceBlock, useNow } from "../components/ui/PresenceBlock";
import { StatusDot } from "../components/ui/StatusDot";
import { lastOnlineLabel } from "../lib/lastOnline";
import buttonStyles from "../components/ui/Button.module.css";
import { ConnectTools } from "../components/ConnectTools";
import { ConnectSheet } from "../components/connect/ConnectSheet";
import { takeConnectDeepLink } from "../lib/connectDeepLink";
import { FriendListItem, FriendListItemSkeleton } from "../components/FriendListItem";
import { SocialFeed } from "../components/feed/SocialFeed";
import { ErrorState } from "../components/ui/ErrorState";
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
  /** A failed list is not an empty list. Without this the cards below would tell a
   *  user with friends that they have none (skills/emil_design_eng §5). */
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /** `/?connect=1` from the menu-bar app. Home renders its own sheet rather than asking
   *  ConnectTools to open its one: ConnectTools skips the sheet entirely while the
   *  status is loading and once the strip has replaced the panel, and the deep link has
   *  to work whatever the tracker phase. */
  const [connectOpen, setConnectOpen] = useState(false);

  useEffect(() => {
    if (takeConnectDeepLink()) setConnectOpen(true);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    friendsApi
      .list()
      .then(({ friends }) => {
        if (active) setFriends(friends);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  // Retry drops the block back to its skeleton, so recovery looks like a first load.
  const retry = () => setAttempt((n) => n + 1);

  const activeFriends = friends.filter((f) => presences.get(f.user.username)?.status === "active");
  // Only ticks once a friend is both non-live and has a known lastSeenAt to render —
  // otherwise this aside never shows a relative time and the interval is dead weight.
  const anyLastSeen = friends.some((f) => {
    const p = presences.get(f.user.username);
    return p !== undefined && p.status !== "active" && p.lastSeenAt !== null;
  });
  const now = useNow(anyLastSeen, 60_000);

  return (
    <div>
      <h1 className={styles.greeting}>Back at it, {user?.displayName}.</h1>
      <p className={styles.subtitle}>What your friends are shipping right now.</p>

      {/* Stays mounted regardless of connected state — it needs to notice an
          already-connected account on mount, not just a live flip, to fire the
          success modal (ConnectTools) reliably. Hides/shows itself. */}
      <ConnectTools variant="banner" />
      <ConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />

      <div className={styles.grid}>
        <div className={styles.mainCol}>
          <section className={styles.section}>
            <SectionTitle icon="sparkles" count={activeFriends.length}>
              Live now
            </SectionTitle>
            <Card className={styles.listCard}>
              {loading ? (
                <FriendListItemSkeleton count={3} live />
              ) : failed ? (
                <ErrorState onRetry={retry} className={styles.empty}>
                  Couldn't load your friends.
                </ErrorState>
              ) : friends.length === 0 ? (
                <div className={styles.empty}>
                  No friends yet — head to <Link to="/friends">Friends</Link> to add some.
                </div>
              ) : activeFriends.length === 0 ? (
                <div className={styles.empty}>Nobody's coding right now.</div>
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

          <section className={styles.section}>
            <SectionTitle icon="commit">
              Vibe Feed
            </SectionTitle>
            <SocialFeed
              friends={friends}
              presences={presences}
              currentUser={user}
            />
          </section>
        </div>

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
              ) : failed ? (
                <ErrorState onRetry={retry} className={styles.empty}>
                  Couldn't load your friends.
                </ErrorState>
              ) : friends.length === 0 ? (
                <div className={styles.empty}>No friends yet.</div>
              ) : (
                <>
                  {friends.slice(0, ALL_FRIENDS_MAX).map((f) => {
                    const presence = presences.get(f.user.username);
                    const live = presence !== undefined && presence.status !== "offline";
                    // Unlike FriendListItem's row/hero PresenceBlock, this aside's dot
                    // has no visible status word next to it — so unlike PresenceBlock's
                    // own showLastSeen (which skips "Offline" as redundant with its
                    // word), the never-seen case is simply not shown here either,
                    // consistent with every other surface: no extra line without data.
                    const lastSeen = !live && presence ? lastOnlineLabel(presence, now) : null;
                    return (
                      <Link key={f.user.id} to={`/u/${f.user.username}`} className={styles.friendRow}>
                        <Avatar src={f.user.avatarUrl} name={f.user.displayName} size={32} />
                        <span className={styles.friendInfo}>
                          <span className={styles.friendName}>
                            {f.user.displayName}
                            <span className={styles.friendHandle}> @{f.user.username}</span>
                          </span>
                          {lastSeen && <span className={styles.friendLastSeen}>{lastSeen}</span>}
                        </span>
                        {live ? (
                          <PresenceBlock
                            presence={presence}
                            variant="compact"
                            showElapsed={false}
                            className={styles.friendPresence}
                          />
                        ) : (
                          <StatusDot status={presence?.status ?? "offline"} className={styles.friendDot} />
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
