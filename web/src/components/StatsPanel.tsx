import { useCallback, useEffect, useState } from "react";
import { statsApi } from "../lib/api";
import { formatActiveTime, formatTokens, humanizeModel, modelFamily, toolFamily, toolLabel } from "../lib/format";
import { isTokenlessTool, TOKENS_NOT_REPORTED } from "../lib/supportedTools";
import { isValidTokenCount, preferServerCost, tokenlessCost } from "../lib/tokenCost";
import { topToolOf, topToolShare } from "../lib/topTool";
import type { UserStats } from "../types";
import { Button } from "./ui/Button";
import { ModelGlyph } from "./ui/ModelGlyph";
import { StatTile } from "./ui/StatTile";
import { ToolGlyph } from "./ui/ToolGlyph";
import { TokenCost, TokenCostDetails } from "./ui/TokenCost";
import styles from "./StatsPanel.module.css";

interface TilesProps {
  stats: UserStats | null;
  /** Given the model's display name — the same string the Models block keys its rows
   *  by, so the tile can hand the block a row to open. Absent when there is no model
   *  to jump to, and the tile stays a plain well. */
  onTopModel?: (label: string) => void;
}

function Tiles({ stats, onTopModel }: TilesProps) {
  const loading = stats === null;
  // The top model's display name is the Models block's row key (`modelRowLabel`), so
  // no translation is needed between the two blocks — but a model the server cannot
  // name has no row to jump to, and the tile goes back to being a number.
  const topModel = stats ? humanizeModel(stats.topModel) : null;
  // Ranked by active time, not clickable (no Models-block equivalent row to jump to).
  // `topToolOf`/`topToolShare` already fold in the older-server byModel fallback.
  const topTool = stats ? topToolOf(stats) : null;
  const toolShare = stats ? topToolShare(stats) : null;
  // This response's own range and original input/output rows, not lifetime/presence.
  // A profile whose every row comes from a tool that publishes no counts has nothing to
  // price: the rows are real, their zeros are not measurements. Before Round 6 this tile
  // priced them anyway and announced `0` / `≈ $0.00` / complete coverage over a Models
  // block that correctly said "tokens not reported" two lines below (fix F-A).
  const rows = stats?.byModel ?? [];
  const unmeasured = rows.length > 0 && rows.every((row) => isTokenlessTool(row.tool));
  // The server's own ≈$ first (it prices cache the web cannot see); exact client
  // estimate from the same rows otherwise. Unknown models never get a guessed rate.
  const cost = unmeasured
    ? tokenlessCost(null)
    : preferServerCost(stats?.byModel.filter((row) => !isTokenlessTool(row.tool)), stats?.totalTokens, stats?.totalEstimatedUsd);

  return (
    <>
      <div className={styles.tiles}>
        <StatTile label="Active time" loading={loading} value={stats ? formatActiveTime(stats.totalActiveSeconds) : undefined} />
        <StatTile
          label="Top model"
          kind="text"
          loading={loading}
          value={stats ? topModel ?? "—" : undefined}
          mark={topModel && <ModelGlyph family={modelFamily(stats?.topModel)} size={18} />}
          onClick={topModel && onTopModel ? () => onTopModel(topModel) : undefined}
          actionLabel={topModel ? `${topModel} — show it in Models` : undefined}
        />
        <StatTile
          label="Top tool"
          kind="tool"
          loading={loading}
          value={stats ? (topTool ? toolLabel(topTool) : "—") : undefined}
          mark={topTool && <ToolGlyph family={toolFamily(topTool)} size={18} />}
          companion={toolShare !== null ? `${Math.round(toolShare * 100)}% of time` : undefined}
        />
        <StatTile label="Streak" loading={loading} value={stats ? `${stats.streak.currentStreak}d` : undefined} />
        <StatTile
          label="Tokens · fuel"
          quiet
          loading={loading}
          value={stats
            ? unmeasured
              ? TOKENS_NOT_REPORTED
              : isValidTokenCount(stats.totalTokens) ? formatTokens(stats.totalTokens) : "—"
            : undefined}
          companion={
            <>
              <TokenCost estimate={cost} />
              {/* QA R2: cache reads are real but secondary — beside the count, never in it. */}
              {!unmeasured && (stats?.totalCachedTokens ?? 0) > 0 && ` · ${formatTokens(stats!.totalCachedTokens!)} cached`}
            </>
          }
        />
      </div>
      <TokenCostDetails />
    </>
  );
}

/**
 * The profile's overall numbers — five tiles and their API estimate disclosure.
 * The per-model breakdown is its own block (`RecentModels`, round 7): one card
 * answers "how much", the next answers "with what".
 */
export function StatsPanel({ username, onTopModel }: { username: string; onTopModel?: (label: string) => void }) {
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
      </div>
    );
  }

  if (state === "error" || !stats) {
    return (
      <div className={styles.error} role="alert">
        <span>Could not load stats.</span>
        <Button size="sm" variant="secondary" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  }

  return <Tiles stats={stats} onTopModel={onTopModel} />;
}
