import { formatDate } from "../lib/format";
import type { WallComment as WallCommentType } from "../types";
import { Avatar } from "./ui/Avatar";
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

  return (
    <div className={styles.row}>
      <Avatar src={comment.author?.avatarUrl} name={authorName} size={36} />
      <div className={styles.bubble}>
        <div className={styles.meta}>
          <span className={styles.author}>{authorName}</span>
          <span className={styles.time}>{formatDate(comment.createdAt)}</span>
          {canDelete && (
            <button type="button" className={styles.deleteBtn} onClick={() => onDelete?.(comment.id)}>
              delete
            </button>
          )}
        </div>
        <p className={styles.body}>{comment.body}</p>
      </div>
    </div>
  );
}
