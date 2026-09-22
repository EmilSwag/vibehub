import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Friend, Presence, User } from "../../types";
import { generateFeedEvents } from "../../lib/feed";
import type { FeedEvent } from "../../lib/feed";
import { Avatar } from "../ui/Avatar";
import { BadgeIcon } from "../achievements/BadgeIcon";
import { showSkewToast } from "../ui/SkewToast";
import styles from "./SocialFeed.module.css";

interface SocialFeedProps {
  friends: Friend[];
  presences: Map<string, Presence>;
  currentUser?: User | null;
}

export function SocialFeed({ friends, presences, currentUser }: SocialFeedProps) {
  const initialEvents = useMemo(() => {
    return generateFeedEvents(friends, presences, currentUser);
  }, [friends, presences, currentUser]);

  const [events, setEvents] = useState<FeedEvent[]>(initialEvents);

  const handleReaction = (eventId: string, kind: "respect" | "flame") => {
    setEvents((prev) =>
      prev.map((ev) => {
        if (ev.id !== eventId) return ev;
        const isRespect = kind === "respect";
        const already = isRespect ? ev.reactions.userReactedRespect : ev.reactions.userReactedFlame;

        return {
          ...ev,
          reactions: {
            ...ev.reactions,
            respect: isRespect
              ? ev.reactions.respect + (already ? -1 : 1)
              : ev.reactions.respect,
            flame: !isRespect
              ? ev.reactions.flame + (already ? -1 : 1)
              : ev.reactions.flame,
            userReactedRespect: isRespect ? !already : ev.reactions.userReactedRespect,
            userReactedFlame: !isRespect ? !already : ev.reactions.userReactedFlame,
          },
        };
      })
    );
  };

  const handleBadgeClick = (ev: FeedEvent) => {
    if (!ev.badgeId) return;
    showSkewToast({
      badgeId: ev.badgeId,
      category: "Community Achievement",
      title: ev.content.title,
      subtitle: `${ev.user.displayName} earned this milestone`,
    });
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.list}>
        {events.map((ev, i) => (
          <article
            key={ev.id}
            className={styles.item}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className={styles.itemHeader}>
              <Link to={`/u/${ev.user.username}`} className={styles.userLink}>
                <Avatar src={ev.user.avatarUrl} name={ev.user.displayName} size={32} />
                <div className={styles.userInfo}>
                  <span className={styles.userName}>{ev.user.displayName}</span>
                  <span className={styles.userHandle}>@{ev.user.username}</span>
                </div>
              </Link>
              <span className={styles.timeBadge}>{ev.timestamp}</span>
            </div>

            <div className={styles.contentBox}>
              {ev.badgeId && (
                <div
                  className={styles.badgePreview}
                  onClick={() => handleBadgeClick(ev)}
                  title="Click to view achievement badge alert"
                  role="button"
                  tabIndex={0}
                >
                  <BadgeIcon id={ev.badgeId} size={24} unlocked />
                </div>
              )}

              <div className={styles.contentMain}>
                <h4 className={styles.contentTitle}>{ev.content.title}</h4>
                <p className={styles.contentDesc}>{ev.content.description}</p>
                {ev.content.meta && (
                  <span className={styles.contentMeta}>{ev.content.meta}</span>
                )}
              </div>
            </div>

            <div className={styles.actionBar}>
              <button
                type="button"
                className={[
                  styles.reactBtn,
                  ev.reactions.userReactedRespect ? styles.reactBtnActive : "",
                ].join(" ")}
                onClick={() => handleReaction(ev.id, "respect")}
                title="Send Respect"
              >
                <span className={styles.reactEmoji}>🤝</span>
                <span>{ev.reactions.respect}</span>
              </button>

              <button
                type="button"
                className={[
                  styles.reactBtn,
                  ev.reactions.userReactedFlame ? styles.reactBtnActive : "",
                ].join(" ")}
                onClick={() => handleReaction(ev.id, "flame")}
                title="Send Flame"
              >
                <span className={styles.reactEmoji}>🔥</span>
                <span>{ev.reactions.flame}</span>
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
