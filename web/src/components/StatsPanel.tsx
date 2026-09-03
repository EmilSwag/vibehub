import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { statsApi } from "../lib/api";
import { formatActiveTime, formatTokens } from "../lib/format";
import type { UserStats } from "../types";
import { Skeleton } from "./ui/Skeleton";
import { StatTile } from "./ui/StatTile";
import styles from "./StatsPanel.module.css";

function ModelBars({ stats }: { stats: UserStats }) {
  const max = Math.max(1, ...stats.byModel.map((m) => m.tokensInput + m.tokensOutput));
  return (
    <div className={styles.barList}>
      {stats.byModel.map((m, i) => {
        const total = m.tokensInput + m.tokensOutput;
        return (
          <div className={styles.barRow} key={`${m.model}-${m.tool}`}>
            <span className={styles.barLabel}>{m.model}</span>
            <div className={styles.barTrack}>
              <div
                className={[styles.barFill, i > 0 && styles.barFillAlt].filter(Boolean).join(" ")}
                style={{ width: `${(total / max) * 100}%` }}
              />
            </div>
            <span className={styles.barValue}>{formatTokens(total)}</span>
          </div>
        );
      })}
      {stats.byModel.length === 0 && (
        <span style={{ color: "var(--vh-text-faint)", fontSize: 13 }}>No activity yet.</span>
      )}
    </div>
  );
}

export function StatsPanel({ username }: { username: string }) {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    statsApi
      .get(username)
      .then((result) => {
        if (active) setStats(result);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [username]);

  if (loading) {
    return (
      <div aria-busy="true">
        <div className={styles.tiles}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} variant="block" height={72} style={{ "--i": i } as CSSProperties} />
          ))}
        </div>
        <div className={styles.barList}>
          <Skeleton height={10} width="80%" />
          <Skeleton height={10} width="55%" />
        </div>
      </div>
    );
  }
  if (!stats) return null;

  return (
    <div>
      <div className={styles.tiles}>
        <StatTile label="Total tokens" value={formatTokens(stats.totalTokens)} highlight />
        <StatTile label="Active time" value={formatActiveTime(stats.totalActiveSeconds)} />
        <StatTile label="Top model" value={stats.topModel ?? "—"} />
        <StatTile label="Streak" value={`${stats.streak.currentStreak}d`} />
      </div>
      <ModelBars stats={stats} />
    </div>
  );
}
