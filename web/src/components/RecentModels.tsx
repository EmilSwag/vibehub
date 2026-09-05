import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { statsApi, toolsOf } from "../lib/api";
import { formatShortDate, formatTokens, modelFamily, toolFamily, toolLabel } from "../lib/format";
import { stagger } from "../lib/motion";
import { formatHoursOnRecord, groupStatsByModel, modelRowLabel } from "../lib/recentModels";
import type { RecentModelRow } from "../lib/recentModels";
import type { UserStats } from "../types";
import type { PresenceLike } from "./ui/PresenceBlock";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";
import { ModelGlyph } from "./ui/ModelGlyph";
import { SectionTitle } from "./ui/SectionTitle";
import { Skeleton } from "./ui/Skeleton";
import { ToolGlyph } from "./ui/ToolGlyph";
import styles from "./RecentModels.module.css";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** Rows visible before "View all N models". Steam shows three; so do we. */
const PREVIEW_ROWS = 3;
const SKELETON_ROWS = 3;

/** "12.4 hours past 2 weeks" — the header's one number, Steam's own phrasing. */
function pastTwoWeeks(seconds: number): string {
  if (seconds < 60) return "Nothing past 2 weeks";
  return `${(seconds / 3600).toFixed(1)} hours past 2 weeks`;
}

/** Every tool and model the person has open right now, keyed the way rows are, so a
 *  live model matches its row without either name being re-derived. */
function liveLabels(presence: PresenceLike | null | undefined): Set<string> {
  return new Set(toolsOf(presence).map((t) => modelRowLabel(t.tool, t.model)));
}

interface RowProps {
  row: RecentModelRow;
  live: boolean;
  /** The server dates its buckets (round 7). Without dates the hours are a 30-day
   *  total, not a lifetime one, so they drop the "on record" claim. */
  dated: boolean;
  compact?: boolean;
  index: number;
}

function Row({ row, live, dated, compact, index }: RowProps) {
  const glyph = row.model ? modelFamily(row.model) : toolFamily(row.tools[0]);
  const namedAfterTool = row.model === null && row.tools.length === 1;
  const tokens = `${row.estimated ? "~" : ""}${formatTokens(row.tokens)} tokens`;

  return (
    <li className={cx(styles.row, compact && styles.rowCompact)} style={stagger(index)}>
      <span className={cx(styles.capsule, compact && styles.capsuleCompact)} aria-hidden="true">
        <ModelGlyph family={glyph} size={compact ? 16 : 26} />
      </span>

      <span className={styles.main}>
        <span className={styles.name}>{row.label}</span>
        <span className={styles.sub}>
          {/* A tool with no model is named after the tool, so repeating it here would
              print the same word twice on two lines. */}
          {!namedAfterTool &&
            row.tools.map((tool) => (
              <span key={tool} className={styles.tool}>
                <ToolGlyph family={toolFamily(tool)} size={12} className={styles.toolGlyph} />
                {toolLabel(tool)}
              </span>
            ))}
          <span
            className={styles.tokens}
            title={row.estimated ? "Tokens — estimated (Quadcode AI logs carry no token counts)" : "Tokens"}
          >
            {tokens}
          </span>
        </span>
      </span>

      <span className={styles.right}>
        <span className={styles.hours}>
          {formatHoursOnRecord(row.activeSeconds)}
          {dated ? " on record" : ""}
        </span>
        {live ? (
          <span className={styles.live}>Currently in use</span>
        ) : (
          dated &&
          row.lastActiveAt && <span className={styles.last}>last used {formatShortDate(row.lastActiveAt)}</span>
        )}
      </span>
    </li>
  );
}

/** The exact silhouette of the loaded list — same grid, same capsule, so nothing
 *  moves when the real rows land. */
function RecentModelsSkeleton() {
  return (
    <ul className={cx(styles.list, "stagger")} aria-hidden="true">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <li key={i} className={styles.row} style={stagger(i)}>
          <Skeleton variant="block" className={styles.capsule} />
          <span className={styles.main}>
            <Skeleton width={148} height={15} />
            <Skeleton width={190} height={12} />
          </span>
          <span className={styles.right}>
            <Skeleton width={104} height={13} />
            <Skeleton width={76} height={12} />
          </span>
        </li>
      ))}
    </ul>
  );
}

interface Props {
  username: string;
  /** Self gets an action in the empty state; a visitor gets the sentence alone. */
  isSelf: boolean;
  /** Drives "Currently in use" — the one place green is allowed in this block. */
  presence?: PresenceLike | null;
  className?: string;
}

/**
 * Steam Recent Activity, one row per model.
 *
 *   MODELS                                                    4
 *   +----------------------------------------------------------+
 *   |                                12.4 hours past 2 weeks    |
 *   |  [  glyph  ]  Claude Opus 5             18.4 hrs on record|
 *   |               Claude Code . 2.1M tokens  Currently in use |
 *   |  ... two more, then "View all 4 models"                   |
 *   +----------------------------------------------------------+
 *
 * Two ranges, two requests: `all` is the lifetime list and its "hrs on record",
 * `14d` is the one number in the header. The row is the model and the tools merge
 * onto its sub-line — someone running Opus from both Claude Code and Codex has
 * used one model, not two.
 */
export function RecentModels({ username, isSelf, presence, className }: Props) {
  const [lifetime, setLifetime] = useState<UserStats | null>(null);
  const [fortnight, setFortnight] = useState<UserStats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setState("loading");
    setLifetime(null);
    setFortnight(null);
    setExpanded(false);
    Promise.all([statsApi.get(username, "all"), statsApi.get(username, "14d")])
      .then(([all, recent]) => {
        if (!active) return;
        setLifetime(all);
        setFortnight(recent);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [username, attempt]);

  const rows = useMemo(() => (lifetime ? groupStatsByModel(lifetime.byModel) : []), [lifetime]);
  const live = useMemo(() => liveLabels(presence), [presence]);
  // A server older than round 7 dates nothing and silently answers `range=all` with
  // its 30-day default, so the dates go away and the hours stop claiming to be a
  // lifetime total rather than quietly misreporting one.
  const dated = rows.some((r) => r.lastActiveAt !== null);

  const shown = expanded ? rows : rows.slice(0, PREVIEW_ROWS);

  return (
    <section className={className}>
      <SectionTitle icon="sparkles" count={rows.length}>
        Models
      </SectionTitle>

      <Card aria-busy={state === "loading" || undefined}>
        {state === "error" ? (
          <div className={styles.error} role="alert">
            <span>Could not load models.</span>
            <Button size="sm" variant="secondary" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : state === "loading" ? (
          <>
            <div className={styles.head}>
              <Skeleton width={168} height={13} />
            </div>
            <RecentModelsSkeleton />
          </>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>
            <span>{isSelf ? "No models yet." : "No models tracked yet."}</span>
            {isSelf && (
              <Link to="/settings#tracker" className={styles.emptyAction}>
                <Icon name="plus" size={13} />
                Connect a tool
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className={styles.head}>
              <span className={styles.headMeta}>{pastTwoWeeks(fortnight?.totalActiveSeconds ?? 0)}</span>
            </div>

            <ul className={cx(styles.list, "stagger")}>
              {shown.map((row, i) => (
                <Row
                  key={row.label}
                  row={row}
                  live={live.has(row.label)}
                  dated={dated}
                  compact={i >= PREVIEW_ROWS}
                  index={i}
                />
              ))}
            </ul>

            {rows.length > PREVIEW_ROWS && (
              <button
                type="button"
                className={styles.toggle}
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
              >
                {expanded ? "Show less" : `View all ${rows.length} models`}
                <Icon name="chevronDown" size={13} className={cx(styles.chevron, expanded && styles.chevronOpen)} />
              </button>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
