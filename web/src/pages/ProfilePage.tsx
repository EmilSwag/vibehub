import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { projectsApi, usersApi, wallApi } from "../lib/api";
import { safeHostname } from "../lib/format";
import type { ExternalLink, LevelBreakdown, Project, User, WallComment as WallCommentType } from "../types";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { ArchetypeGlyph, archetypeLabel } from "../components/ui/ArchetypeGlyph";
import { PresenceBlock } from "../components/ui/PresenceBlock";
import { Icon } from "../components/ui/Icon";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Textarea } from "../components/ui/Input";
import buttonStyles from "../components/ui/Button.module.css";
import { LinkIcon } from "../components/LinkIcon";
import { ProjectCard } from "../components/ProjectCard";
import { WallComment } from "../components/WallComment";
import { StatsPanel } from "../components/StatsPanel";
import { SectionTitle } from "../components/ui/SectionTitle";
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

/** Identity block placeholder — same four bands the loaded hero occupies, so the
 *  page below it doesn't jump when the profile lands. */
function HeroSkeleton() {
  return (
    <div className={styles.heroSkeleton}>
      <Skeleton width={220} height={32} />
      <Skeleton width={150} height={16} />
      <SkeletonText lines={2} />
      <Skeleton variant="pill" width={132} height={28} />
    </div>
  );
}

export function ProfilePage() {
  const { username = "" } = useParams();
  const { user: me } = useAuth();
  const { presences, watchWall } = useRealtime();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState<WallCommentType[]>([]);
  const [wallLoading, setWallLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [wallError, setWallError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const isSelf = me?.username === username;

  useEffect(() => {
    let active = true;
    setProfile(null);
    setNotFound(false);
    setProjects([]);
    setProjectsLoading(true);
    setComments([]);
    setNextCursor(null);
    setWallLoading(true);

    usersApi
      .get(username)
      .then((data) => active && setProfile(data))
      .catch(() => active && setNotFound(true));

    projectsApi
      .list(username)
      .then(({ projects, likedIds }) => {
        if (!active) return;
        setProjects(projects);
        setLikedIds(new Set(likedIds));
      })
      .catch(() => undefined)
      .finally(() => active && setProjectsLoading(false));

    wallApi
      .list(username)
      .then(({ comments, nextCursor }) => {
        if (!active) return;
        setComments(comments);
        setNextCursor(nextCursor);
      })
      .catch(() => undefined)
      .finally(() => active && setWallLoading(false));

    return () => {
      active = false;
    };
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
    return <p className={styles.notFound}>No profile at @{username}.</p>;
  }

  const presence = presences.get(username);

  // The page keeps one shape from the first frame — only the identity block swaps
  // skeleton for content, so nothing below it moves when the profile lands.
  return (
    <div>
      <div className={styles.hero} aria-busy={profile ? undefined : true}>
        {profile ? (
          <Avatar src={profile.user.avatarUrl} name={profile.user.displayName} size={96} />
        ) : (
          <Skeleton variant="circle" width={96} />
        )}

        <div className={styles.heroInfo}>
          {profile ? (
            <>
              <div className={styles.nameRow}>
                <h1 className={styles.displayName}>{profile.user.displayName}</h1>
                {profile.user.roles.map((r) => (
                  <Badge key={r}>{roleTitle(r)}</Badge>
                ))}
                {profile.user.archetype && (
                  <Badge active>
                    <ArchetypeGlyph archetype={profile.user.archetype} /> {archetypeLabel(profile.user.archetype)}
                  </Badge>
                )}
              </div>

              <span className={styles.username}>@{profile.user.username}</span>

              {/* Only friends' presence is known to the client; anyone else gets no
                  status rather than a misleading "Offline". */}
              {presence && <PresenceBlock presence={presence} variant="hero" className={styles.presence} />}

              {profile.user.bio && <p className={styles.bio}>{profile.user.bio}</p>}

              {profile.links.length > 0 && (
                <div className={styles.links}>
                  {profile.links.map((link) => (
                    <a key={link.id} className={styles.linkChip} href={link.url} target="_blank" rel="noreferrer">
                      <LinkIcon icon={link.icon} />
                      {link.label ?? safeHostname(link.url)}
                    </a>
                  ))}
                </div>
              )}

              <p className={styles.friendCount}>{profile.friendCount} friends</p>
            </>
          ) : (
            <HeroSkeleton />
          )}
        </div>

        <div className={styles.heroActions}>
          {profile ? (
            <LevelBadge level={profile.levelBreakdown.level} breakdown={profile.levelBreakdown} />
          ) : (
            <span className={styles.levelSkeleton}>
              <Skeleton variant="circle" width={76} />
              <Skeleton width={24} height={14} />
            </span>
          )}
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
        <SectionTitle icon="commit">Stats</SectionTitle>
        <Card>
          <StatsPanel username={username} />
        </Card>
      </section>

      <section className={styles.section}>
        <SectionTitle icon="image" count={projects.length}>
          Projects
        </SectionTitle>
        {projectsLoading ? (
          <div className={styles.projectGrid} aria-busy="true">
            {[0, 1].map((i) => (
              <Card key={i} className={styles.projectSkeleton}>
                <Skeleton width="62%" height={20} />
                <SkeletonText lines={2} />
                <Skeleton width="46%" height={13} />
              </Card>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className={styles.emptyBlock}>
            <p className={styles.empty}>{isSelf ? "No projects yet." : "No public projects yet."}</p>
            {isSelf && (
              <Link to="/projects" className={styles.emptyAction}>
                <Icon name="plus" size={14} />
                New project
              </Link>
            )}
          </div>
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
        {/* The count is the full wall, so it only shows once every page is loaded. */}
        <SectionTitle icon="text" count={nextCursor ? undefined : comments.length}>
          Wall
        </SectionTitle>

        {me && (
          <Card className={styles.composer}>
            <form className={styles.postForm} onSubmit={handlePostComment}>
              <div className={styles.postRow}>
                <Textarea
                  className={styles.postField}
                  placeholder="Write something…"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  maxLength={1000}
                  rows={2}
                />
                <Button type="submit" className={styles.postBtn} disabled={posting || !newComment.trim()}>
                  {posting ? "Posting…" : "Post"}
                </Button>
              </div>
              {wallError && (
                <span className={styles.wallError} role="alert">
                  {wallError}
                </span>
              )}
            </form>
          </Card>
        )}

        {wallLoading ? (
          <div className={styles.wallList} aria-busy="true">
            {[0, 1].map((i) => (
              <div className={styles.wallSkeletonRow} key={i}>
                <Skeleton variant="circle" width={36} />
                <Skeleton variant="block" height={73} />
              </div>
            ))}
          </div>
        ) : comments.length === 0 ? (
          <p className={styles.empty}>No posts yet.</p>
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
