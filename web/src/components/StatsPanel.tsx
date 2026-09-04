import { useCallback, useEffect, useState } from "react";
import { statsApi } from "../lib/api";
import { formatActiveTime, formatTokens, humanizeModel, modelFamily, toolFamily, toolLabel } from "../lib/format";
import type { StatByModel, UserStats } from "../types";
import { Button } from "./ui/Button";
import { ModelGlyph } from "./ui/ModelGlyph";
import { Skeleton } from "./ui/Skeleton";
import { StatTile } from "./ui/StatTile";
import styles from "./StatsPanel.module.css";

const SKELETON_ROWS = 3;

/**
 * One row per (model, tool): glyph + "Claude Sonnet 4.5 · Claude Code" — the tool
 * alone when the model is unknown — then that row's own hours and tokens, never a
 * mixed total. Server order (tokens desc) is kept: tokens are fuel, not rank, but
 * they are what the list is bucketed by.
 */
function ModelRow({ row }: { row: StatByModel }) {
  const model = humanizeModel(row.model);
  const tool = toolLabel(row.tool);
  return (
    <li className={styles.modelRow}>
      <span className={styles.modelLeft}>
        <ModelGlyph
          family={model ? modelFamily(row.model) : toolFamily(row.tool)}
          size={16}
          className={styles.modelIcon}
        />
        <span className={styles.modelName}>
          {model ?? tool}
          {model && (
            <>
              <span className={styles.sep} aria-hidden="true">
                {" · "}
              </span>
              <span className={styles.modelTool}>{tool}</span>
            </>
          )}
        </span>
      </span>
      <span className={styles.time}>{formatActiveTime(row.activeSeconds)}</span>
      <span className={styles.tokens}>{formatTokens(row.tokensInput + row.tokensOutput)}</span>
    </li>
  );
}

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
        <ul className={styles.modelList} aria-hidden="true">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <li className={styles.modelRow} key={i}>
              <span className={styles.modelLeft}>
                <Skeleton variant="circle" width={16} />
                <Skeleton width={168} height={13} />
              </span>
              <span className={styles.numSkeleton}>
                <Skeleton width={44} height={12} />
              </span>
              <span className={styles.numSkeleton}>
                <Skeleton width={40} height={12} />
              </span>
            </li>
          ))}
        </ul>
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
        <ul className={styles.modelList}>
          {stats.byModel.map((m) => (
            <ModelRow row={m} key={`${m.model}-${m.tool}`} />
          ))}
        </ul>
      )}
    </div>
  );
}
