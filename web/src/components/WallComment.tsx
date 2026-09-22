import { Link } from "react-router-dom";
import { formatDate } from "../lib/format";
import type { WallComment as WallCommentType } from "../types";
import { Avatar } from "./ui/Avatar";
import { Icon } from "./ui/Icon";
import styles from "./WallComment.module.css";

export function WallComment({
  comment,
  canDelete,
  onDelete,
}: {
  comment: WallCommentType;
  canDelete?: boolean;
  onDelete?: (id: string) => void;
}) {
  const authorName = comment.author?.displayName ?? "someone";
  const username = comment.author?.username;

  const avatarEl = <Avatar src={comment.author?.avatarUrl} name={authorName} size={36} />;

  return (
    <div className={styles.row}>
      {username ? (
        <Link to={`/u/${username}`} className={styles.avatarLink} aria-label={`Profile of ${authorName}`}>
          {avatarEl}
        </Link>
      ) : (
        avatarEl
      )}
      <div className={styles.bubble}>
        <div className={styles.meta}>
          {username ? (
            <Link to={`/u/${username}`} className={styles.authorLink}>
              {authorName}
            </Link>
          ) : (
            <span className={styles.author}>{authorName}</span>
          )}
          <span className={styles.time}>{formatDate(comment.createdAt)}</span>
          {canDelete && (
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={() => onDelete?.(comment.id)}
              aria-label="Delete comment"
              title="Delete comment"
            >
              <Icon name="trash" size={13} />
            </button>
          )}
        </div>
        <p className={styles.body}>{comment.body}</p>
      </div>
    </div>
  );
}