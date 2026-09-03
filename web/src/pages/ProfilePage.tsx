import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { projectsApi, usersApi, wallApi } from "../lib/api";
import { presenceLine, safeHostname } from "../lib/format";
import type { ExternalLink, LevelBreakdown, Project, User, WallComment as WallCommentType } from "../types";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { ArchetypeGlyph, archetypeLabel } from "../components/ui/ArchetypeGlyph";
import { StatusDot } from "../components/ui/StatusDot";
import { Icon } from "../components/ui/Icon";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Textarea } from "../components/ui/Input";
import buttonStyles from "../components/ui/Button.module.css";
import { LinkIcon } from "../components/LinkIcon";
import { ProjectCard } from "../components/ProjectCard";
import { WallComment } from "../components/WallComment";
import { StatsPanel } from "../components/StatsPanel";
import { Skeleton, SkeletonText } from "../components/ui/Skeleton";
import { LevelBadge } from "../components/ui/LevelBadge";
import { roleTitle } from "../components/ui/RoleGlyph";
import styles from "./ProfilePage.module.css";

interface ProfileData {
  user: User;
  links: ExternalLink[];
  friendCount: number;
  level: number;
  levelBreakdown: LevelBreakdown;
}

export function ProfilePage() {
  const { username = "" } = useParams();
  const { user: me } = useAuth();
  const { presences, watchWall } = useRealtime();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState<WallCommentType[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [wallError, setWallError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const isSelf = me?.username === username;

  useEffect(() => {
    setProfile(null);
    setNotFound(false);
    usersApi
      .get(username)
      .then((data) => setProfile(data))
      .catch(() => setNotFound(true));

    projectsApi.list(username).then(({ projects }) => setProjects(projects));

    wallApi.list(username).then(({ comments, nextCursor }) => {
      setComments(comments);
      setNextCursor(nextCursor);
    });
  }, [username]);

  useEffect(() => {
    return watchWall(username, (comment) => {
      setComments((prev) => [comment, ...prev]);
    });
  }, [username, watchWall]);

  const loadMoreComments = useCallback(async () => {
    if (!nextCursor) return;
    const res = await wallApi.list(username, nextCursor);
    setComments((prev) => [...prev, ...res.comments]);
    setNextCursor(res.nextCursor);
  }, [username, nextCursor]);

  async function handlePostComment(event: FormEvent) {
    event.preventDefault();
    if (!newComment.trim()) return;
    setPosting(true);
    setWallError(null);
    try {
      const { comment } = await wallApi.post(username, newComment.trim());
      setComments((prev) => [comment, ...prev]);
      setNewComment("");
    } catch (err) {
      setWallError(err instanceof Error ? err.message : "Could not post comment");
    } finally {
      setPosting(false);
    }
  }

  async function handleDeleteComment(id: string) {
    await wallApi.remove(id);
    setComments((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleToggleLike(project: Project) {
    const isLiked = likedIds.has(project.id);
    const result = isLiked ? await projectsApi.unlike(project.id) : await projectsApi.like(project.id);
    setLikedIds((prev) => {
      const next = new Set(prev);
      isLiked ? next.delete(project.id) : next.add(project.id);
      return next;
    });
    setProjects((prev) =>
      prev.map((p) => (p.id === project.id ? { ...p, likeCount: result.likeCount } : p))
    );
  }

  if (notFound) {
    return <p className={styles.empty}>No one at @{username} — this profile doesn't exist.</p>;
  }

  if (!profile) {
    // Same silhouette as the hero below so nothing jumps when data lands.
    return (
      <div>
        <div className={styles.hero} aria-busy="true">
          <Skeleton variant="circle" width={96} />
          <div className={styles.heroInfo}>
            <Skeleton width={220} height={26} style={{ marginBottom: 10 }} />
            <Skeleton width={140} height={13} style={{ marginBottom: 14 }} />
            <SkeletonText lines={2} />
          </div>
        </div>
        <section className={styles.section}>
          <Skeleton width={60} height={12} style={{ marginBottom: 12 }} />
          <Card>
            <SkeletonText lines={3} />
          </Card>
        </section>
      </div>
    );
  }

  const { user, links, friendCount, levelBreakdown } = profile;
  const presence = presences.get(username);

  return (
    <div>
      <div className={styles.hero}>
        <Avatar src={user.avatarUrl} name={user.displayName} size={96} />
        <div className={styles.heroInfo}>
          <div className={styles.nameRow}>
            <h1 className={styles.displayName}>{user.displayName}</h1>
            <span className={styles.username}>@{user.username}</span>
            {user.roles.map((r) => (
              <Badge key={r}>{roleTitle(r)}</Badge>
            ))}
            {user.archetype && (
              <Badge active>
                <ArchetypeGlyph archetype={user.archetype} /> {archetypeLabel(user.archetype)}
              </Badge>
            )}
          </div>

          {presence && (
            <StatusDot
              status={presence.status}
              label={presence.activity ? presenceLine(presence.activity) : presence.status}
            />
          )}

          {user.bio && <p className={styles.bio}>{user.bio}</p>}

          {links.length > 0 && (
            <div className={styles.links}>
              {links.map((link) => (
                <a key={link.id} className={styles.linkChip} href={link.url} target="_blank" rel="noreferrer">
                  <LinkIcon icon={link.icon} />
                  {link.label ?? safeHostname(link.url)}
                </a>
              ))}
            </div>
          )}

          <p className={styles.friendCount}>{friendCount} friends</p>
        </div>

        <div className={styles.heroActions}>
          <LevelBadge level={levelBreakdown.level} breakdown={levelBreakdown} />
          {isSelf && (
            <Link
              to="/settings"
              className={[buttonStyles.btn, buttonStyles.secondary, styles.editProfileDesktop].join(" ")}
            >
              Edit profile
            </Link>
          )}
        </div>
      </div>

      {isSelf && (
        <Link
          to="/settings"
          className={[buttonStyles.btn, buttonStyles.secondary, styles.editProfileMobile].join(" ")}
        >
          Edit profile
        </Link>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Stats</h2>
        <Card>
          <StatsPanel username={username} />
        </Card>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Projects</h2>
        {projects.length === 0 ? (
          isSelf ? (
            <Link to="/projects" className={styles.emptyAction}>
              <Icon name="plus" size={14} />
              New project
            </Link>
          ) : (
            <p className={styles.empty}>No public projects yet.</p>
          )
        ) : (
          <div className={styles.projectGrid}>
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                liked={likedIds.has(project.id)}
                onToggleLike={me ? handleToggleLike : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Wall</h2>

        {me && (
          <Card style={{ marginBottom: 16 }}>
            <form className={styles.postForm} onSubmit={handlePostComment}>
              <Textarea
                placeholder={isSelf ? "Say something to visitors…" : `Write on ${user.displayName}'s wall…`}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                maxLength={1000}
                rows={2}
              />
              {wallError && <span style={{ color: "var(--vh-accent-hover)", fontSize: 13 }}>{wallError}</span>}
              <div className={styles.postActions}>
                <Button type="submit" disabled={posting || !newComment.trim()}>
                  {posting ? "Posting…" : "Post"}
                </Button>
              </div>
            </form>
          </Card>
        )}

        {comments.length === 0 ? (
          <p className={styles.empty}>No wall posts yet.</p>
        ) : (
          <div className={styles.wallList}>
            {comments.map((comment) => (
              <WallComment
                key={comment.id}
                comment={comment}
                canDelete={me?.id === comment.authorId || isSelf}
                onDelete={handleDeleteComment}
              />
            ))}
          </div>
        )}

        {nextCursor && (
          <Button variant="secondary" onClick={loadMoreComments}>
            Load more
          </Button>
        )}
      </section>
    </div>
  );
}
