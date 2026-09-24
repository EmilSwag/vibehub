import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { ACHIEVEMENTS_DEF, knownAchievements, unlockedLabel } from "../../lib/achievements";
import type { Achievement } from "../../lib/achievements";
import { achievementsApi, isNotFound } from "../../lib/api";
import { stagger } from "../../lib/motion";
import { BadgeIcon } from "./BadgeIcon";
import { Card } from "../ui/Card";
import { ErrorState } from "../ui/ErrorState";
import { SectionTitle } from "../ui/SectionTitle";
import { showSkewToast } from "../ui/SkewToast";
import { Skeleton, SkeletonText } from "../ui/Skeleton";
import styles from "./Achievements.module.css";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

interface AchievementsListProps {
  username: string;
  /** The signed-in person is looking at their own profile: shows "Preview alert". */
  isSelf: boolean;
  /** The page's own section class — the block renders its title and card itself so
   *  it can hide entirely (title included) on a server that predates the route. */
  className?: string;
}

type Status = "loading" | "ready" | "failed" | "unavailable";

/** The card's exact silhouette: icon square, title line, two lines of copy, the 4px bar. */
function GridSkeleton() {
  return (
    <div className={cx(styles.grid, "stagger")} aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={cx(styles.card, styles.cardSkeleton)} style={stagger(i)}>
          <Skeleton variant="block" width={48} height={48} className={styles.skelIcon} />
          <Skeleton width="56%" height={15} />
          <SkeletonText lines={2} />
          <Skeleton variant="pill" height={4} className={styles.skelBar} />
        </div>
      ))}
    </div>
  );
}

/**
 * The trophy cabinet, drawn from `GET /users/:username/achievements` and nothing
 * else (meta/plans/vibehub-honest-achievements-feed.md, B2/B3). Every row carries the
 * server's own unlocked flag, progress, honest progress label and the stored unlock
 * moment; the web adds copy and a badge. Skeleton / error / empty like every block
 * (skills/emil_design_eng §5), and hidden altogether on a 404 — an older server.
 */
export function AchievementsList({ username, isSelf, className }: AchievementsListProps) {
  const [rows, setRows] = useState<Achievement[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setRows([]);
    setStatus("loading");
    achievementsApi
      .get(username)
      .then(({ achievements }) => {
        if (!active) return;
        setRows(knownAchievements(achievements));
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (active) setStatus(isNotFound(err) ? "unavailable" : "failed");
      });
    return () => {
      active = false;
    };
  }, [username, attempt]);

  if (status === "unavailable") return null;

  const unlockedCount = rows.filter((a) => a.unlocked).length;

  const showBadge = (a: Achievement) => {
    const def = ACHIEVEMENTS_DEF[a.id];
    showSkewToast({
      badgeId: a.id,
      category: a.unlocked ? unlockedLabel(a.unlockedAt) : "Locked",
      title: def.title,
      subtitle: a.unlocked ? def.description : a.progressLabel,
      duration: 6000,
      // A tap on a card is a look, not an unlock — fireworks stay for the real thing
      // (hooks/useAchievementUnlocks.ts) and the owner's preview below.
      fireworks: false,
    });
  };

  const onCardKey = (event: KeyboardEvent<HTMLDivElement>, a: Achievement) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      showBadge(a);
    }
  };

  return (
    <section className={className}>
      <SectionTitle icon="sparkles">Achievements</SectionTitle>
      <Card>
        {status === "loading" ? (
          <GridSkeleton />
        ) : status === "failed" ? (
          <ErrorState onRetry={() => setAttempt((n) => n + 1)}>Couldn't load achievements.</ErrorState>
        ) : rows.length === 0 ? (
          <p className={styles.empty}>No badges yet.</p>
        ) : (
          <div className={styles.wrap}>
            <div className={styles.headerBar}>
              <span className={styles.headerSummary}>
                Unlocked {unlockedCount} of {rows.length}
              </span>
            </div>

            <div className={cx(styles.grid, "stagger")}>
              {rows.map((item, i) => {
                const def = ACHIEVEMENTS_DEF[item.id];
                const pct = Math.round(Math.min(1, Math.max(0, item.progress)) * 100);
                return (
                  <div
                    key={item.id}
                    className={cx(styles.card, item.unlocked ? styles.cardUnlocked : styles.cardLocked)}
                    style={stagger(i)}
                    onClick={() => showBadge(item)}
                    onKeyDown={(e) => onCardKey(e, item)}
                    role="button"
                    tabIndex={0}
                    aria-label={`${def.title}: ${item.unlocked ? unlockedLabel(item.unlockedAt) : item.progressLabel}`}
                  >
                    <div className={styles.cardHeader}>
                      <div className={styles.iconSlot}>
                        <BadgeIcon id={item.id} size={28} unlocked={item.unlocked} />
                      </div>
                      {item.unlocked ? (
                        <span className={styles.unlockedBadge}>Unlocked</span>
                      ) : (
                        <span className={styles.lockedBadge}>{def.tagline}</span>
                      )}
                    </div>

                    <div className={styles.info}>
                      <h4 className={styles.title}>{def.title}</h4>
                      <p className={styles.desc}>{def.description}</p>
                    </div>

                    {/* Locked: the server's real numbers and how far along. Unlocked:
                        the requirement it met and when — the stored moment, not "100%". */}
                    <div className={styles.progressSection}>
                      <div className={styles.progressLabelRow}>
                        <span className={styles.progressText}>{item.unlocked ? def.requirement : item.progressLabel}</span>
                        <span className={styles.progressValue}>
                          {item.unlocked ? unlockedLabel(item.unlockedAt) : `${pct}%`}
                        </span>
                      </div>
                      <div className={styles.progressBar} aria-hidden="true">
                        <div className={styles.progressFill} style={{ width: `${item.unlocked ? 100 : pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
