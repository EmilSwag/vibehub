import { useCallback, useEffect, useState } from "react";
import { statsApi } from "../lib/api";
import { formatActiveTime, formatTokens, humanizeModel } from "../lib/format";
import type { UserStats } from "../types";
import { Button } from "./ui/Button";
import { StatTile } from "./ui/StatTile";
import { ToolRows, ToolRowsSkeleton } from "./ToolRows";
import styles from "./StatsPanel.module.css";

const SKELETON_ROWS = 3;

function Tiles({ stats }: { stats: UserStats | null }) {
  const loading = stats === null;
  return (
    <div className={styles.tiles}>
      <StatTile label="Active time" loading={loading} value={stats ? formatActiveTime(stats.totalActiveSeconds) : undefined} />
      <StatTile label="Top model" kind="text" loading={loading} value={stats ? humanizeModel(stats.topModel) ?? "—" : undefined} />
      <StatTile label="Streak" loading={loading} value={stats ? `${stats.streak.currentStreak}d` : undefined} />
      <StatTile label="Tokens · fuel" quiet loading={loading} value={stats ? formatTokens(stats.totalTokens) : undefined} />
    </div>
  );
}

export function StatsPanel({ username }: { username: string }) {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setState("loading");
    setStats(null);
    statsApi
      .get(username)
      .then((result) => {
        if (!active) return;
        setStats(result);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [username, attempt]);

  if (state === "loading") {
    return (
      <div aria-busy="true">
        <Tiles stats={null} />
        <ToolRowsSkeleton count={SKELETON_ROWS} />
      </div>
    );
  }

  if (state === "error" || !stats) {
    return (
      <div className={styles.error} role="alert">
        <span>Couldn't load stats.</span>
        <Button size="sm" variant="secondary" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Tiles stats={stats} />
      {stats.byModel.length === 0 ? (
        <div className={styles.empty}>No activity yet.</div>
      ) : (
        <ToolRows rows={stats.byModel} />
      )}
    </div>
  );
}
