import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { statsApi } from "../lib/api";
import { formatActiveTime, formatTokens } from "../lib/format";
import type { UserStats } from "../types";
import { StatTile } from "./ui/StatTile";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
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

function StatsSummary({ stats }: { stats: UserStats }) {
  return (
    <>
      <div className={styles.tiles}>
        <StatTile label="Total tokens" value={formatTokens(stats.totalTokens)} highlight />
        <StatTile label="Active time" value={formatActiveTime(stats.totalActiveSeconds)} />
        <StatTile label="Top model" value={stats.topModel ?? "—"} />
        <StatTile label="Streak" value={`${stats.streak.currentStreak}d`} />
      </div>
      <ModelBars stats={stats} />
    </>
  );
}

export function StatsPanel({ username }: { username: string }) {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [compareWith, setCompareWith] = useState("");
  const [compareResult, setCompareResult] = useState<{ a: UserStats; b: UserStats } | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

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

  async function handleCompare(event: FormEvent) {
    event.preventDefault();
    setCompareError(null);
    if (!compareWith.trim()) return;
    try {
      const result = await statsApi.compare(username, compareWith.trim());
      setCompareResult(result);
    } catch (err) {
      setCompareResult(null);
      setCompareError(err instanceof Error ? err.message : "Could not load comparison");
    }
  }

  if (loading) return <span style={{ color: "var(--vh-text-faint)" }}>Loading stats…</span>;
  if (!stats) return null;

  return (
    <div>
      <StatsSummary stats={stats} />

      <form className={styles.compareForm} onSubmit={handleCompare}>
        <Input
          placeholder="compare with username…"
          value={compareWith}
          onChange={(e) => setCompareWith(e.target.value)}
        />
        <Button type="submit" variant="secondary">
          Compare
        </Button>
      </form>
      {compareError && <p style={{ color: "var(--vh-accent-hover)", fontSize: 13 }}>{compareError}</p>}

      {compareResult && (
        <div className={styles.compareGrid}>
          <div className={styles.compareCol}>
            <h4>{username}</h4>
            <StatsSummary stats={compareResult.a} />
          </div>
          <div className={styles.compareCol}>
            <h4>{compareWith}</h4>
            <StatsSummary stats={compareResult.b} />
          </div>
        </div>
      )}
    </div>
  );
}
