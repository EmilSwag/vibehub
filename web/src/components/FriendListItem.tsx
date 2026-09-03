import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Presence, User } from "../types";
import { Avatar } from "./ui/Avatar";
import { StatusDot } from "./ui/StatusDot";
import { presenceLine } from "../lib/format";
import styles from "./FriendListItem.module.css";

export function FriendListItem({
  user,
  daysAsFriends,
  presence,
  action,
}: {
  user: User;
  daysAsFriends: number;
  presence?: Presence;
  action?: ReactNode;
}) {
  const status = presence?.status ?? "offline";
  const label = presence?.activity ? presenceLine(presence.activity) : status;

  return (
    <Link to={`/u/${user.username}`} className={styles.row}>
      <Avatar src={user.avatarUrl} name={user.displayName} size={44} />
      <div className={styles.info}>
        <div className={styles.name}>{user.displayName}</div>
        <StatusDot status={status} label={label} />
        <div className={styles.meta}>friends for {daysAsFriends} days</div>
      </div>
      {action}
    </Link>
  );
}
