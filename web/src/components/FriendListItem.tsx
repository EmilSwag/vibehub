import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { stagger } from "../lib/motion";
import type { User } from "../types";
import { Avatar } from "./ui/Avatar";
import { PresenceBlock } from "./ui/PresenceBlock";
import type { PresenceLike } from "./ui/PresenceBlock";
import { Skeleton } from "./ui/Skeleton";
import styles from "./FriendListItem.module.css";

interface Props {
  user: User;
  daysAsFriends: number;
  /** Missing/null renders as offline. */
  presence?: PresenceLike | null;
  /** Trailing control (Unfriend). It renders inside the row link — call
   * `preventDefault` in its handler. */
  action?: ReactNode;
  /** 0-based position for `.stagger` parents: sets `--i` on the row itself so
   * rows stay siblings (dividers rely on `:last-child`). */
  index?: number;
}

/**
 * One friend: avatar · name · PresenceBlock (row) · faint "friends for N days".
 * Offline rows are one presence line tall, live rows four — the row grows, the
 * rhythm (16px padding, hairline divider, avatar pinned to the top) stays.
 */
export function FriendListItem({ user, daysAsFriends, presence, action, index }: Props) {
  return (
    <Link to={`/u/${user.username}`} className={styles.row} style={index === undefined ? undefined : stagger(index)}>
      <Avatar src={user.avatarUrl} name={user.displayName} size={44} />
      <div className={styles.info}>
        <div className={styles.name}>{user.displayName}</div>
        <PresenceBlock presence={presence} variant="row" />
      </div>
      <div className={styles.side}>
        <span className={styles.meta}>friends for {daysAsFriends} days</span>
        {action}
      </div>
    </Link>
  );
}

interface SkeletonProps {
  count?: number;
  /** Reserve the four-line live block instead of the one-line offline one. */
  live?: boolean;
  /** Trailing pill where an action button will land. */
  withAction?: boolean;
}

/** The row's exact silhouette, staggered in like the rows it stands in for. */
export function FriendListItemSkeleton({ count = 3, live = false, withAction = false }: SkeletonProps) {
  const lines = live ? [56, 120, 176, 52] : [56];
  return (
    <div className="stagger" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.row} style={stagger(i)}>
          <Skeleton variant="circle" width={44} />
          <div className={styles.info}>
            <span className={styles.skelLine}>
              <Skeleton width={128} height={13} />
            </span>
            {lines.map((w, j) => (
              <span key={j} className={styles.skelLine}>
                <Skeleton width={w} height={11} />
              </span>
            ))}
          </div>
          <div className={styles.side}>
            <Skeleton width={104} height={11} />
            {withAction && <Skeleton variant="pill" width={52} height={16} />}
          </div>
        </div>
      ))}
    </div>
  );
}
