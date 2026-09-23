import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { feedApi, isNotFound } from "../../lib/api";
import { appendPage, applyReactionResult, feedTimeLabel, toggleReactionLocally, updateEvent } from "../../lib/feedEvents";
import { stagger } from "../../lib/motion";
import type { FeedEvent, ReactionKind } from "../../types";
import { BadgeIcon } from "../achievements/BadgeIcon";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ErrorState } from "../ui/ErrorState";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { useNow } from "../ui/PresenceBlock";
import { SectionTitle } from "../ui/SectionTitle";
import { Skeleton } from "../ui/Skeleton";
import { StatusDot } from "../ui/StatusDot";
import styles from "./SocialFeed.module.css";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

/** Home lists self + friends (`GET /feed`); a profile lists that one person (`GET /users/:u/feed`). */
export type FeedScope = { kind: "home" } | { kind: "user"; username: string };

interface SocialFeedProps {
  scope: FeedScope;
  /** The page's own section class — the block owns its title so it can hide whole. */
  className?: string;
}

type Status = "loading" | "ready" | "failed" | "unavailable";

const PAGE_SIZE = 30;
const SKELETON_ROWS = 3;

const REACTIONS: { kind: ReactionKind; icon: IconName; label: string }[] = [
  { kind: "respect", icon: "handshake", label: "Respect" },
  { kind: "flame", icon: "flame", label: "Flame" },
];

/** The row's exact silhouette: avatar, name line, title, description, two pills. */
function FeedSkeleton() {
  return (
    <div className="stagger" aria-busy="true">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div key={i} className={styles.row} style={stagger(i)}>
          <Skeleton variant="circle" width={36} />
          <div className={styles.body}>
            <span className={styles.skelLine}>
              <Skeleton width={150} height={12} />
            </span>
            <span className={styles.skelLine}>
              <Skeleton width="58%" height={14} />
            </span>
            <span className={styles.skelLine}>
              <Skeleton width="40%" height={12} />
            </span>
          </div>
          <div className={styles.reactions}>
            <Skeleton variant="pill" width={52} height={28} />
            <Skeleton variant="pill" width={52} height={28} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The Vibe Feed — real events of real people (meta/plans/vibehub-honest-achievements-feed.md,
 * B5/B6): finished and live sessions, badge unlocks, projects, commit days, new
 * friendships, each backed by a row and each carrying persisted, shared reactions.
 * The hard-coded fixtures (invented people, invented counts, string timestamps) this
 * replaces are gone with lib/feed.ts.
 *
 * States (skills/emil_design_eng §5): shape-matched skeleton, inline error with retry,
 * one-sentence empty state — and nothing at all, title included, when the server
 * answers 404 (it predates the feed).
 */
export function SocialFeed({ scope, className }: SocialFeedProps) {
  const { user: me } = useAuth();
  const kind = scope.kind;
  const username = scope.kind === "user" ? scope.username : null;

  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Where the newest page starts — only those rows stagger in; older ones stay put. */
  const [revealFrom, setRevealFrom] = useState(0);
  /** The one row whose last reaction did not save; cleared on the next tap. */
  const [failedReaction, setFailedReaction] = useState<string | null>(null);
  /** `<eventId>:<kind>` toggles in flight — a second tap waits for the first answer. */
  const pending = useRef(new Set<string>());

  const fetchPage = (before?: string) =>
    kind === "home"
      ? feedApi.list({ limit: PAGE_SIZE, before })
      : feedApi.forUser(username ?? "", { limit: PAGE_SIZE, before });

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
    // fetchPage is derived from exactly these two values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, username, attempt]);

  // Relative times tick once a minute while there is something to date.
  const now = useNow(status === "ready" && events.length > 0, 60_000);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextBefore);
      // Reactions may have changed rows meanwhile, never their count — so the length
      // this press saw is where the new rows begin.
      setRevealFrom(events.length);
      setEvents((prev) => appendPage(prev, page.events));
      setNextBefore(page.nextBefore);
    } catch {
      // The button stays; a second press retries.
    } finally {
      setLoadingMore(false);
    }
  };

  const toggle = async (id: string, reaction: ReactionKind) => {
    const key = `${id}:${reaction}`;
    if (!me || pending.current.has(key)) return;
    pending.current.add(key);
    setFailedReaction(null);
    // Optimistic: the pill flips now, the count with it; the server's answer then
    // replaces both (someone else may have reacted meanwhile).
    setEvents((prev) => updateEvent(prev, id, (e) => toggleReactionLocally(e, reaction)));
    try {
      const result = await feedApi.react(id, reaction);
      setEvents((prev) => updateEvent(prev, id, (e) => applyReactionResult(e, result)));
    } catch {
      // Flip back — applying the toggle twice restores the original.
      setEvents((prev) => updateEvent(prev, id, (e) => toggleReactionLocally(e, reaction)));
      setFailedReaction(id);
    } finally {
      pending.current.delete(key);
    }
  };

  if (status === "unavailable") return null;

  return (
    <section className={className}>
      <SectionTitle icon="commit">Vibe Feed</SectionTitle>
      <Card className={styles.card}>
        {status === "loading" ? (
          <FeedSkeleton />
        ) : status === "failed" ? (
          <ErrorState onRetry={() => setAttempt((n) => n + 1)} className={styles.empty}>
            Couldn't load the feed.
          </ErrorState>
        ) : events.length === 0 ? (
          <p className={styles.empty}>
            Nothing in the last 30 days.
            {kind === "home" && (
              <>
                {" "}
                <Link to="/friends">Find friends</Link>
              </>
            )}
          </p>
        ) : (
          <div className="stagger">
            {events.map((ev, i) => (
              <article key={ev.id} className={styles.row} style={stagger(Math.max(0, i - revealFrom))}>
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
                    {ev.live ? (
                      // The one hue in the product: a session still beating right now.
                      <StatusDot status="active" pulse label="Live" className={styles.live} />
                    ) : (
                      <time dateTime={ev.at} className={styles.time}>
                        {feedTimeLabel(ev, now)}
                      </time>
                    )}
                  </div>

                  <div className={styles.title}>
                    {ev.badgeId && <BadgeIcon id={ev.badgeId} size={18} unlocked className={styles.badge} />}
                    {ev.type === "project" && ev.projectId ? (
                      <Link to={`/p/${ev.projectId}`} className={styles.titleLink}>
                        {ev.title}
                      </Link>
                    ) : (
                      <span>{ev.title}</span>
                    )}
                    {ev.type === "friendship" && ev.other && (
                      <span>
                        with{" "}
                        <Link to={`/u/${ev.other.username}`} className={styles.titleLink}>
                          {ev.other.displayName}
                        </Link>
                      </span>
                    )}
                  </div>

                  {ev.description && <p className={styles.desc}>{ev.description}</p>}
                </div>

                <div className={styles.reactions}>
                  {REACTIONS.map(({ kind: reaction, icon, label }) => {
                    const active = ev.reactions.mine[reaction];
                    const count = ev.reactions[reaction];
                    return (
                      <button
                        key={reaction}
                        type="button"
                        className={cx(styles.react, active && styles.reactActive)}
                        aria-pressed={active}
                        aria-label={`${label}, ${count}`}
                        title={me ? label : "Sign in to react"}
                        disabled={!me}
                        onClick={() => void toggle(ev.id, reaction)}
                      >
                        <Icon name={icon} size={14} className={styles.glyph} />
                        <span className={styles.count}>{count}</span>
                      </button>
                    );
                  })}
                  {failedReaction === ev.id && (
                    <span className={styles.reactError} role="alert">
                      Didn't save. Tap again.
                    </span>
                  )}
                </div>
              </article>
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
