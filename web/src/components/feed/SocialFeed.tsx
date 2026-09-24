import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { feedApi, isNotFound, postsApi } from "../../lib/api";
import { appendPage, applyReactionResult, feedTimeLabel, toggleReactionLocally, updateEvent } from "../../lib/feedEvents";
import { stagger } from "../../lib/motion";
import type { FeedEvent, ReactionKind } from "../../types";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ErrorState } from "../ui/ErrorState";
import { Icon } from "../ui/Icon";
import { useNow } from "../ui/PresenceBlock";
import { SectionTitle } from "../ui/SectionTitle";
import { Skeleton } from "../ui/Skeleton";
import styles from "./SocialFeed.module.css";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac/i.test(navigator.platform ?? "") || /Macintosh|Mac OS X/i.test(navigator.userAgent ?? "");
}

export type FeedScope = { kind: "home" } | { kind: "user"; username: string };

interface SocialFeedProps {
  scope: FeedScope;
  className?: string;
}

type Status = "loading" | "ready" | "failed" | "unavailable";

const PAGE_SIZE = 30;
const SKELETON_ROWS = 3;

function FeedSkeleton() {
  return (
    <div className="stagger" aria-busy="true">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div key={i} className={styles.row} style={stagger(i)}>
          <Skeleton variant="circle" width={36} height={36} />
          <div className={styles.body}>
            <span className={styles.skelLine}>
              <Skeleton width={140} height={12} />
            </span>
            <span className={styles.skelLine}>
              <Skeleton width="88%" height={14} />
            </span>
            <span className={styles.skelLine}>
              <Skeleton width="55%" height={14} />
            </span>
            <div className={styles.actionsRow} style={{ marginTop: 6 }}>
              <Skeleton variant="pill" width={48} height={24} />
              <Skeleton variant="pill" width={48} height={24} />
              <Skeleton variant="pill" width={48} height={24} />
              <Skeleton variant="pill" width={40} height={24} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface PostRowProps {
  event: FeedEvent;
  index: number;
  revealFrom: number;
  now: number;
  currentUsername: string | null;
  failedReaction: string | null;
  onToggleReaction: (id: string, kind: ReactionKind) => void;
  onDelete: (id: string) => void;
  onVisible: (id: string) => void;
}

function FeedPostRow({
  event: ev,
  index,
  revealFrom,
  now,
  currentUsername,
  failedReaction,
  onToggleReaction,
  onDelete,
  onVisible,
}: PostRowProps) {
  const isMine = Boolean(currentUsername && currentUsername === ev.user.username);
  const canDelete = Boolean(ev.canDelete ?? isMine);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const rowRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = rowRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    let fired = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !fired) {
            fired = true;
            onVisible(ev.id);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ev.id, onVisible]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [menuOpen]);

  const handleDeleteClick = () => {
    setDeleting(true);
    onDelete(ev.id);
  };

  const rawPostId = ev.id.startsWith("post:")
    ? ev.id.slice(5)
    : ev.id.startsWith("project:")
    ? ev.id.slice(8)
    : ev.id;
  const isOptimistic = ev.id.startsWith("temp:");

  return (
    <article
      ref={rowRef}
      className={styles.row}
      style={stagger(Math.max(0, index - revealFrom))}
      data-post-id={rawPostId}
    >
      <Link to={`/u/${ev.user.username}`} className={styles.avatarLink} aria-label={`Profile of ${ev.user.displayName}`}>
        <Avatar src={ev.user.avatarUrl} name={ev.user.displayName} size={36} />
      </Link>

      <div className={styles.body}>
        <div className={styles.meta}>
          <Link to={`/u/${ev.user.username}`} className={styles.name}>
            {ev.user.displayName}
          </Link>
          <span className={styles.handle}>@{ev.user.username}</span>
          <span className={styles.sep} aria-hidden="true">
            ·
          </span>
          <time dateTime={ev.at} className={styles.time}>
            {feedTimeLabel(ev, now)}
          </time>

          {ev.suggested && <span className={styles.suggestedBadge}>Suggested</span>}

          {canDelete && !isOptimistic && (
            <div className={styles.menuWrapper}>
              {confirmDelete ? (
                <div className={styles.deleteConfirm}>
                  <span>Delete?</span>
                  <button
                    type="button"
                    className={styles.deleteConfirmBtn}
                    disabled={deleting}
                    onClick={handleDeleteClick}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className={styles.deleteCancelBtn}
                    onClick={() => {
                      setConfirmDelete(false);
                      setMenuOpen(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.menuBtn}
                    aria-label="Post options"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen((prev) => !prev);
                    }}
                  >
                    <Icon name="moreHorizontal" size={15} />
                  </button>
                  {menuOpen && (
                    <div className={styles.menuDropdown}>
                      <button
                        type="button"
                        className={styles.menuItem}
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete(true);
                        }}
                      >
                        <Icon name="trash" size={13} />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {ev.projectId ? (
          <div>
            <Link to={`/p/${ev.projectId}`} className={styles.projectTitleLink}>
              {ev.title}
            </Link>
            {ev.description && <p className={styles.postContent}>{ev.description}</p>}
          </div>
        ) : (
          <p className={styles.postContent}>{ev.content || ev.title}</p>
        )}

        <div className={styles.actionsRow}>
          {/* Heart / Like */}
          <button
            type="button"
            className={cx(styles.react, ev.reactions.mine.like && styles.reactActive)}
            aria-pressed={ev.reactions.mine.like}
            aria-label={`Like, ${ev.reactions.like}`}
            title={currentUsername ? "Like" : "Sign in to like"}
            disabled={!currentUsername || isOptimistic}
            onClick={() => onToggleReaction(ev.id, "like")}
          >
            <Icon name="heart" size={13} className={styles.glyph} />
            <span className={styles.count}>{ev.reactions.like}</span>
          </button>

          {/* Respect */}
          <button
            type="button"
            className={cx(styles.react, ev.reactions.mine.respect && styles.reactActive)}
            aria-pressed={ev.reactions.mine.respect}
            aria-label={`Respect, ${ev.reactions.respect}`}
            title={currentUsername ? "Respect" : "Sign in to react"}
            disabled={!currentUsername || isOptimistic}
            onClick={() => onToggleReaction(ev.id, "respect")}
          >
            <Icon name="handshake" size={13} className={styles.glyph} />
            <span className={styles.count}>{ev.reactions.respect}</span>
          </button>

          {/* Flame */}
          <button
            type="button"
            className={cx(styles.react, ev.reactions.mine.flame && styles.reactActive)}
            aria-pressed={ev.reactions.mine.flame}
            aria-label={`Flame, ${ev.reactions.flame}`}
            title={currentUsername ? "Flame" : "Sign in to react"}
            disabled={!currentUsername || isOptimistic}
            onClick={() => onToggleReaction(ev.id, "flame")}
          >
            <Icon name="flame" size={13} className={styles.glyph} />
            <span className={styles.count}>{ev.reactions.flame}</span>
          </button>

          {/* Views (unique, read-only) */}
          <span className={styles.viewsIndicator} title="Unique views" aria-label={`${ev.views ?? 0} views`}>
            <Icon name="eye" size={13} className={styles.viewsGlyph} />
            <span className={styles.count}>{ev.views ?? 0}</span>
          </span>

          {failedReaction === ev.id && (
            <span className={styles.reactError} role="alert">
              Didn't save. Tap again.
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export function SocialFeed({ scope, className }: SocialFeedProps) {
  const { user: me } = useAuth();
  const kind = scope.kind;
  const username = scope.kind === "user" ? scope.username : null;
  const isSelf = Boolean(me && scope.kind === "user" && me.username === scope.username);
  const canPost = Boolean(me && (kind === "home" || isSelf));

  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revealFrom, setRevealFrom] = useState(0);
  const [failedReaction, setFailedReaction] = useState<string | null>(null);

  // Composer state
  const [postText, setPostText] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  const pendingReactions = useRef(new Set<string>());
  const viewedPosts = useRef(new Set<string>());

  const fetchPage = useCallback(
    (before?: string) =>
      kind === "home"
        ? feedApi.list({ limit: PAGE_SIZE, before })
        : feedApi.forUser(username ?? "", { limit: PAGE_SIZE, before }),
    [kind, username]
  );

  useEffect(() => {
    let active = true;
    setEvents([]);
    setNextBefore(null);
    setRevealFrom(0);
    setFailedReaction(null);
    setStatus("loading");
    fetchPage()
      .then((page) => {
        if (!active) return;
        setEvents(page.events);
        setNextBefore(page.nextBefore);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (active) setStatus(isNotFound(err) ? "unavailable" : "failed");
      });
    return () => {
      active = false;
    };
  }, [fetchPage, attempt]);

  const now = useNow(status === "ready" && events.length > 0, 60_000);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextBefore);
      setRevealFrom(events.length);
      setEvents((prev) => appendPage(prev, page.events));
      setNextBefore(page.nextBefore);
    } catch {
      // Retried on next press
    } finally {
      setLoadingMore(false);
    }
  };

  const toggle = async (id: string, reaction: ReactionKind) => {
    const key = `${id}:${reaction}`;
    if (!me || pendingReactions.current.has(key)) return;
    pendingReactions.current.add(key);
    setFailedReaction(null);

    setEvents((prev) => updateEvent(prev, id, (e) => toggleReactionLocally(e, reaction)));
    try {
      const result = await feedApi.react(id, reaction);
      setEvents((prev) => updateEvent(prev, id, (e) => applyReactionResult(e, result)));
    } catch {
      setEvents((prev) => updateEvent(prev, id, (e) => toggleReactionLocally(e, reaction)));
      setFailedReaction(id);
    } finally {
      pendingReactions.current.delete(key);
    }
  };

  const handlePostSubmit = async () => {
    const text = postText.trim();
    if (!text || posting || !me) return;

    setPosting(true);
    setPostError(null);

    // Optimistic insert at top
    const tempId = `temp:${Date.now()}`;
    const optimisticPost: FeedEvent = {
      id: tempId,
      type: "post",
      at: new Date().toISOString(),
      user: {
        id: me.id,
        username: me.username,
        displayName: me.displayName,
        avatarUrl: me.avatarUrl,
      },
      title: text,
      content: text,
      description: null,
      suggested: false,
      views: 0,
      canDelete: true,
      reactions: {
        like: 0,
        respect: 0,
        flame: 0,
        mine: { like: false, respect: false, flame: false },
      },
    };

    setEvents((prev) => [optimisticPost, ...prev]);
    setPostText("");

    try {
      const { post } = await postsApi.create(text);
      setEvents((prev) => prev.map((e) => (e.id === tempId ? post : e)));
    } catch (err: unknown) {
      // Rollback optimistic post
      setEvents((prev) => prev.filter((e) => e.id !== tempId));
      setPostText(text);
      setPostError(err instanceof Error ? err.message : "Couldn't publish post. Try again.");
    } finally {
      setPosting(false);
    }
  };

  const handleDeletePost = async (eventId: string) => {
    const rawId = eventId.startsWith("post:")
      ? eventId.slice(5)
      : eventId.startsWith("project:")
      ? eventId.slice(8)
      : eventId;
    // Optimistic removal from UI
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    try {
      await postsApi.delete(rawId);
    } catch {
      // If delete failed, reload feed
      setAttempt((n) => n + 1);
    }
  };

  const handleVisiblePost = useCallback(async (eventId: string) => {
    const rawId = eventId.startsWith("post:")
      ? eventId.slice(5)
      : eventId.startsWith("project:")
      ? eventId.slice(8)
      : eventId;
    if (eventId.startsWith("temp:") || viewedPosts.current.has(rawId)) return;
    viewedPosts.current.add(rawId);

    try {
      const res = await postsApi.recordView(rawId);
      if (res && typeof res.views === "number") {
        setEvents((prev) =>
          prev.map((e) => {
            const eRaw = e.id.startsWith("post:")
              ? e.id.slice(5)
              : e.id.startsWith("project:")
              ? e.id.slice(8)
              : e.id;
            return eRaw === rawId ? { ...e, views: res.views } : e;
          })
        );
      }
    } catch {
      // Silent view failure
    }
  }, []);

  const focusComposer = () => {
    composerInputRef.current?.focus();
  };

  if (status === "unavailable") return null;

  return (
    <section className={className}>
      <SectionTitle icon="text">Vibe Feed</SectionTitle>

      {/* Composer on Home & Own Profile */}
      {canPost && (
        <Card className={styles.composerCard}>
          <div className={styles.composer}>
            <div className={styles.composerAvatar}>
              <Avatar src={me?.avatarUrl} name={me?.displayName ?? ""} size={36} />
            </div>
            <div className={styles.composerBody}>
              <textarea
                ref={composerInputRef}
                value={postText}
                onChange={(e) => setPostText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void handlePostSubmit();
                  }
                }}
                placeholder={kind === "home" ? "Share an update with your feed…" : "Write a post on your profile…"}
                className={styles.textarea}
                rows={2}
                maxLength={2000}
                disabled={posting}
                aria-label="Write a post"
              />
              <div className={styles.composerFooter}>
                <span className={styles.composerHint}>
                  {postText.length > 0 ? `${postText.length}/2000` : isMac() ? "⌘+Enter to post" : "Ctrl+Enter to post"}
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  loading={posting}
                  disabled={!postText.trim() || posting}
                  onClick={() => void handlePostSubmit()}
                >
                  Post
                </Button>
              </div>
              {postError && (
                <div className={styles.composerError} role="alert">
                  {postError}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Feed Card */}
      <Card className={styles.card}>
        {status === "loading" ? (
          <FeedSkeleton />
        ) : status === "failed" ? (
          <ErrorState onRetry={() => setAttempt((n) => n + 1)} className={styles.empty}>
            Couldn't load the feed.
          </ErrorState>
        ) : events.length === 0 ? (
          <p className={styles.empty}>
            No posts yet.
            {canPost ? (
              <>
                {" "}
                <button type="button" className={styles.emptyFocusBtn} onClick={focusComposer}>
                  Write your first post above.
                </button>
              </>
            ) : kind === "home" ? (
              <>
                {" "}
                <Link to="/friends">Find friends</Link> to see their updates.
              </>
            ) : null}
          </p>
        ) : (
          <div className="stagger">
            {events.map((ev, i) => (
              <FeedPostRow
                key={ev.id}
                event={ev}
                index={i}
                revealFrom={revealFrom}
                now={now}
                currentUsername={me?.username ?? null}
                failedReaction={failedReaction}
                onToggleReaction={toggle}
                onDelete={handleDeletePost}
                onVisible={handleVisiblePost}
              />
            ))}
          </div>
        )}
      </Card>

      {status === "ready" && nextBefore && (
        <Button variant="secondary" className={styles.more} loading={loadingMore} onClick={() => void loadMore()}>
          Load more
        </Button>
      )}
    </section>
  );
}
