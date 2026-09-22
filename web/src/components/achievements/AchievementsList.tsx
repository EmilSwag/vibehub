import { useMemo } from "react";
import type { LevelBreakdown, UserStats } from "../../types";
import { evaluateAchievements, extractUserStatsContext } from "../../lib/achievements";
import type { Achievement } from "../../lib/achievements";
import { BadgeIcon } from "./BadgeIcon";
import { showSkewToast } from "../ui/SkewToast";
import styles from "./Achievements.module.css";

interface AchievementsListProps {
  levelBreakdown?: LevelBreakdown;
  userStats?: UserStats | null;
  onSelect?: (achievement: Achievement) => void;
}

export function AchievementsList({ levelBreakdown, userStats, onSelect }: AchievementsListProps) {
  const achievements = useMemo(() => {
    const ctx = extractUserStatsContext(levelBreakdown, userStats);
    return evaluateAchievements(ctx);
  }, [levelBreakdown, userStats]);

  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  const handleCardClick = (a: Achievement) => {
    onSelect?.(a);
    showSkewToast({
      badgeId: a.id,
      category: a.unlocked ? "Achievement Unlocked" : "Achievement In Progress",
      title: a.title.toUpperCase(),
      subtitle: `${a.tagline} — ${a.requirement}`,
      duration: 30000,
    });
  };

  const handleTestAlert = () => {
    const randomA = achievements[Math.floor(Math.random() * achievements.length)];
    showSkewToast({
      badgeId: randomA.id,
      category: "Achievement Unlocked",
      title: randomA.title.toUpperCase(),
      subtitle: `${randomA.tagline} · ${randomA.description}`,
      duration: 30000,
    });
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.headerBar}>
        <span className={styles.headerSummary}>
          Unlocked {unlockedCount} of {achievements.length} badges
        </span>
        <button
          type="button"
          className={styles.testBtn}
          onClick={handleTestAlert}
          title="Trigger celebratory skewed alert"
        >
          // Test Alert
        </button>
      </div>

      <div className={styles.grid}>
        {achievements.map((item, i) => {
          const pct = Math.round(item.progress * 100);
          return (
            <div
              key={item.id}
              className={[
                styles.card,
                item.unlocked ? styles.cardUnlocked : styles.cardLocked,
              ].join(" ")}
              style={{ animationDelay: `${i * 45}ms` }}
              onClick={() => handleCardClick(item)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCardClick(item);
                }
              }}
              title={`Click to view badge alert: ${item.title}`}
            >
              <div className={styles.topRow}>
                <div className={styles.iconSlot}>
                  <BadgeIcon id={item.id} size={30} unlocked={item.unlocked} />
                </div>
                <span
                  className={[
                    styles.statusPill,
                    item.unlocked ? styles.pillUnlocked : styles.pillLocked,
                  ].join(" ")}
                >
                  {item.unlocked ? "Unlocked" : "Locked"}
                </span>
              </div>

              <div className={styles.info}>
                <h4 className={styles.title}>{item.title}</h4>
                <p className={styles.desc}>{item.description}</p>
              </div>

              <div className={styles.progressSection}>
                <div className={styles.progressLabelRow}>
                  <span>{item.requirement}</span>
                  <span>{item.unlocked ? "100%" : `${pct}%`}</span>
                </div>
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${item.unlocked ? 100 : pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
