import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Link } from "react-router-dom";
import { statsApi, toolsOf } from "../lib/api";
import { formatShortDate, formatTokens, modelFamily, toolFamily, toolLabel } from "../lib/format";
import type { ToolFamily } from "../lib/format";
import { prefersReducedMotion, stagger } from "../lib/motion";
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

/** A request to open the block on one model — the Stats "Top model" tile sends these.
 *  `nonce` is what makes a second click on the same tile land: the label alone would
 *  be an unchanged prop and the effect would not run again. */
export interface ModelFocus {
  label: string;
  nonce: number;
}

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

const tokenCount = (tokens: number, estimated: boolean) =>
  `${estimated ? "~" : ""}${formatTokens(tokens)} tokens`;

const TOKENS_TITLE = "Tokens — estimated (Quadcode AI logs carry no token counts)";

interface RowProps {
  row: RecentModelRow;
  live: boolean;
  /** The server dates its buckets (round 7). Without dates the hours are a 30-day
   *  total, not a lifetime one, so they drop the "on record" claim. */
  dated: boolean;
  compact?: boolean;
  index: number;
  /** Clicked, so it stays picked out of the list it just opened. */
  selected: boolean;
  /** Its per-tool detail line is open. Only ever true once the list is expanded. */
  open: boolean;
  /** A tool filter is on and this row does not run that tool. */
  muted: boolean;
  /** The list is still collapsed, so this row's click is "show me all of them"
   *  rather than "split this one by tool". */
  reveals: boolean;
  onSelect: (label: string) => void;
  activeTool: ToolFamily | null;
  onToolToggle: (tool: ToolFamily) => void;
}

function Row({
  row,
  live,
  dated,
  compact,
  index,
  selected,
  open,
  muted,
  reveals,
  onSelect,
  activeTool,
  onToolToggle,
}: RowProps) {
  const glyph = row.model ? modelFamily(row.model) : toolFamily(row.tools[0]);
  const namedAfterTool = row.model === null && row.tools.length === 1;
  const item = useRef<HTMLLIElement>(null);

  // Bring the picked row into view — from a click here, or from the Stats tile
  // jumping in from above. `nearest` is deliberate: a row already on screen must not
  // be yanked to the middle of the viewport just because it was clicked.
  useEffect(() => {
    if (!selected) return;
    const node = item.current;
    if (!node) return;
    const frame = requestAnimationFrame(() =>
      node.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [selected]);

  const action = reveals
    ? `${row.label} — show every model`
    : open
      ? `${row.label} — hide its tools`
      : `${row.label} — show its tools`;

  return (
    <li ref={item} className={cx(styles.item, muted && styles.itemMuted)} style={stagger(index)}>
      <div className={cx(styles.row, compact && styles.rowCompact, selected && styles.rowSelected)}>
        {/* The row is a real button stretched over the whole band. It is a sibling
            behind the content rather than a wrapper because the tool chips are buttons
            too and a button cannot nest in a button; the content is inert to the
            pointer (`.row > *` below), so a click anywhere but a chip lands here. */}
        <button
          type="button"
          className={styles.rowHit}
          onClick={() => onSelect(row.label)}
          aria-expanded={reveals ? false : open}
          aria-current={selected || undefined}
          aria-label={action}
        />

        <span className={cx(styles.capsule, compact && styles.capsuleCompact)} aria-hidden="true">
          <ModelGlyph family={glyph} size={compact ? 16 : 26} />
        </span>

        <span className={styles.main}>
          <span className={styles.name}>{row.label}</span>
          <span className={styles.sub}>
            {/* A tool with no model is named after the tool, so repeating it here would
                print the same word twice on two lines. */}
            {!namedAfterTool &&
              row.tools.map((tool) => {
                const family = toolFamily(tool);
                const on = activeTool === family;
                return (
                  <button
                    key={tool}
                    type="button"
                    className={cx(styles.tool, styles.toolChip, on && styles.toolChipOn)}
                    // The chip is not inside `.rowHit`, so nothing bubbles there today.
                    // Stopping anyway keeps the chip's own meaning if the row handler
                    // ever moves onto the <li>.
                    onClick={(event: MouseEvent<HTMLButtonElement>) => {
                      event.stopPropagation();
                      onToolToggle(family);
                    }}
                    aria-pressed={on}
                    title={
                      on
                        ? `Clear the ${toolLabel(tool)} filter`
                        : `Pick out every model run from ${toolLabel(tool)}`
                    }
                  >
                    <ToolGlyph family={family} size={12} className={styles.toolGlyph} />
                    {toolLabel(tool)}
                  </button>
                );
              })}
            <span className={styles.tokens} title={row.estimated ? TOKENS_TITLE : "Tokens"}>
              {tokenCount(row.tokens, row.estimated)}
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
      </div>

      {/* The row's own arithmetic, un-merged: one line per tool that ran this model.
          `byTool` is already sorted by hours, so the tool that did most of the work
          reads first. */}
      <div className={cx(styles.detail, open && styles.detailOpen)}>
        <div className={styles.detailInner}>
          <ul className={styles.toolLines}>
            {row.byTool.map((bucket) => (
              <li key={bucket.tool} className={styles.toolLine}>
                <span className={styles.toolLineName}>
                  <ToolGlyph family={toolFamily(bucket.tool)} size={13} className={styles.toolGlyph} />
                  {toolLabel(bucket.tool)}
                </span>
                <span className={styles.toolLineHours}>{formatHoursOnRecord(bucket.activeSeconds)}</span>
                <span className={styles.toolLineTokens} title={bucket.estimated ? TOKENS_TITLE : "Tokens"}>
                  {tokenCount(bucket.tokens, bucket.estimated)}
                </span>
                <span className={styles.toolLineLast}>
                  {dated && bucket.lastActiveAt ? `last used ${formatShortDate(bucket.lastActiveAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </li>
  );
}

/** The exact silhouette of the loaded list — same grid, same 120x45 capsule holding
 *  the 26px mark, so nothing moves when the real rows land. */
function RecentModelsSkeleton() {
  return (
    <ul className={cx(styles.list, "stagger")} aria-hidden="true">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <li key={i} className={styles.item} style={stagger(i)}>
          <div className={styles.row}>
            <Skeleton variant="block" className={styles.capsule} />
            <span className={styles.main}>
              <Skeleton width={148} height={15} />
              <Skeleton width={190} height={12} />
            </span>
            <span className={styles.right}>
              <Skeleton width={104} height={13} />
              <Skeleton width={76} height={12} />
            </span>
          </div>
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
  /** Open on one model, sent by the Stats "Top model" tile. */
  focus?: ModelFocus | null;
  className?: string;
}

/**
 * Steam Recent Activity, one row per model.
 *
 *   MODELS                                                    4
 *   +----------------------------------------------------------+
 *   |                                12.4 hours past 2 weeks    |
 *   |  [  mark   ]  Claude Opus 5             18.4 hrs on record|
 *   |               Claude Code . 2.1M tokens  Currently in use |
 *   |  ... two more, then "View all 4 models"                   |
 *   +----------------------------------------------------------+
 *
 * Two ranges, two requests: `all` is the lifetime list and its "hrs on record",
 * `14d` is the one number in the header. The row is the model and the tools merge
 * onto its sub-line — someone running Opus from both Claude Code and Codex has
 * used one model, not two.
 *
 * Round 8 made the rows controls. Collapsed, a row opens the full list and stays
 * picked out. Open, it splits itself back into the tools that ran it. A tool chip
 * lights every row that ran that tool and fades the rest. Escape and "Show less"
 * put all three back.
 */
export function RecentModels({ username, isSelf, presence, focus, className }: Props) {
  const [lifetime, setLifetime] = useState<UserStats | null>(null);
  const [fortnight, setFortnight] = useState<UserStats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [expanded, setExpanded] = useState(false);
  /** Label of the row that is picked out. */
  const [selected, setSelected] = useState<string | null>(null);
  /** Label of the row whose per-tool detail line is open. */
  const [openRow, setOpenRow] = useState<string | null>(null);
  /** Tool chip that is on: rows running that tool stay lit, the rest fade. */
  const [toolFilter, setToolFilter] = useState<ToolFamily | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setState("loading");
    setLifetime(null);
    setFortnight(null);
    setExpanded(false);
    setSelected(null);
    setOpenRow(null);
    setToolFilter(null);
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

  const canExpand = rows.length > PREVIEW_ROWS;
  const shown = expanded ? rows : rows.slice(0, PREVIEW_ROWS);

  /** One undo for all three states — "Show less" and Escape's last step share it. */
  const collapse = useCallback(() => {
    setExpanded(false);
    setSelected(null);
    setOpenRow(null);
    setToolFilter(null);
  }, []);

  /**
   * A row does one of two things, depending on what it can see.
   * Collapsed: open the whole list and pick this row out of it.
   * Open: split this row into its tools, or fold it back if it is already split.
   */
  const selectRow = useCallback(
    (label: string) => {
      const reveals = canExpand && !expanded;
      setSelected(label);
      if (reveals) {
        setExpanded(true);
        setOpenRow(null);
        return;
      }
      setOpenRow((current) => (current === label ? null : label));
    },
    [canExpand, expanded],
  );

  /** A tool chip lights every row that ran that tool. It opens the list with it: a
   *  match hiding under "View all N models" would look like the filter found nothing. */
  const toggleTool = useCallback(
    (family: ToolFamily) => {
      setToolFilter((current) => (current === family ? null : family));
      setSelected(null);
      setOpenRow(null);
      if (canExpand) setExpanded(true);
    },
    [canExpand],
  );

  // The Stats "Top model" tile lands here: open the list, pick that row out, and let
  // the row scroll itself into view. A label the list does not have is ignored rather
  // than leaving a highlight nothing can explain.
  useEffect(() => {
    if (!focus) return;
    if (!rows.some((row) => row.label === focus.label)) return;
    setToolFilter(null);
    setOpenRow(null);
    setSelected(focus.label);
    if (canExpand) setExpanded(true);
  }, [focus, rows, canExpand]);

  const usesFilteredTool = (row: RecentModelRow) =>
    toolFilter === null || row.tools.some((tool) => toolFamily(tool) === toolFilter);

  /** Escape peels one layer at a time — filter, then the open detail, then the
   *  highlight, then the list. It only claims the key when there is something to
   *  undo, so anything above still sees its own Escape. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    if (toolFilter !== null) setToolFilter(null);
    else if (openRow !== null) setOpenRow(null);
    else if (selected !== null) setSelected(null);
    else if (expanded) collapse();
    else return;
    event.stopPropagation();
  };

  return (
    <section className={className} onKeyDown={onKeyDown}>
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
                  selected={selected === row.label}
                  open={openRow === row.label}
                  muted={!usesFilteredTool(row)}
                  reveals={canExpand && !expanded}
                  onSelect={selectRow}
                  activeTool={toolFilter}
                  onToolToggle={toggleTool}
                />
              ))}
            </ul>

            {canExpand && (
              <button
                type="button"
                className={styles.toggle}
                onClick={() => (expanded ? collapse() : setExpanded(true))}
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
