import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { toolsOf } from "../../lib/api";
import { formatActiveTime, formatTokens, humanizeModel, modelFamily, toolFamily, toolLabel } from "../../lib/format";
import { modelsOfSources, sumToday } from "../../lib/sources";
import type { TrackerStatus } from "../../types";
import { Button } from "./Button";
import { Confetti } from "./Confetti";
import { ModelGlyph } from "./ModelGlyph";
import styles from "./ConnectCelebration.module.css";

const WORDS = ["All", "connected."];

/** Fireworks and the word reveal both finish inside this; the layer itself stays
 *  until the person leaves it (motion budget, skills/emil_design_eng §6). */
const SHOW_MS = 5200;

/** Poll cadence while the layer is up — the counter must move, not sit at zero. */
const COUNTER_POLL_MS = 5000;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Props {
  open: boolean;
  /** Live tracker status — the chips, the counter and the models all come from it. */
  status: TrackerStatus | null;
  /** Pulls a fresh status; called every 5s while the layer is open. */
  onRefresh: () => void;
  onClose: () => void;
}

/**
 * The moment the first heartbeat lands.
 *
 * Full-screen, monochrome fireworks behind a big serif "All connected.", then the
 * three things that prove it is real: what you are in right now, how much you have
 * run today (ticking, not frozen), and every model the tracker can see. One way
 * out: "Enter".
 */
export function ConnectCelebration({ open, status, onRefresh, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // The counter has to move while the person watches it, so this layer polls faster
  // than the panel behind it does.
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => onRefresh(), COUNTER_POLL_MS);
    return () => window.clearInterval(id);
  }, [open, onRefresh]);

  const sources = status?.sources ?? [];
  const today = useMemo(() => sumToday(sources), [sources]);
  const models = useMemo(() => modelsOfSources(sources), [sources]);

  // What the person is in right now — presence when it is live, the most recently
  // seen source otherwise, so the chips are never empty on a fresh connection.
  const chips = useMemo(() => {
    const primary = toolsOf(status?.presence)[0];
    if (primary) {
      return [toolLabel(primary.tool), humanizeModel(primary.model), primary.projectAlias].filter(
        (v): v is string => Boolean(v)
      );
    }
    const first = sources[0];
    if (first) return [toolLabel(first.tool), humanizeModel(first.model)].filter((v): v is string => Boolean(v));
    return [];
  }, [status?.presence, sources]);

  if (!open) return null;

  const reduced = prefersReducedMotion();

  // Portalled to <body> on purpose: every page sits inside a wrapper that keeps a
  // transform after its reveal animation (motion.css .reveal, fill-mode both), and a
  // transformed ancestor becomes the containing block for position: fixed — which
  // shrinks a "full-screen" layer to the width of the block it was rendered in.
  return createPortal(
    <div className={styles.layer} role="dialog" aria-modal="true" aria-labelledby="connect-celebration-title">
      {!reduced && <Confetti durationMs={SHOW_MS} />}

      <div className={styles.stage}>
        <h1 id="connect-celebration-title" className={styles.title} aria-label={WORDS.join(" ")}>
          {WORDS.map((w, i) => (
            <span key={w} className={styles.word} style={{ "--i": i } as CSSProperties} aria-hidden="true">
              {w}
            </span>
          ))}
        </h1>

        {chips.length > 0 && (
          <ul className={styles.chips}>
            {chips.map((c, i) => (
              <li key={c} className={styles.chip} style={{ "--i": i } as CSSProperties}>
                {c}
              </li>
            ))}
          </ul>
        )}

        <div className={styles.counter}>
          <div className={styles.metric}>
            <span className={styles.metricValue}>
              {today.estimated ? "~" : ""}
              {formatTokens(today.tokens)}
            </span>
            <span className={styles.metricLabel}>tokens today</span>
          </div>
          <span className={styles.metricRule} aria-hidden="true" />
          <div className={styles.metric}>
            <span className={styles.metricValue}>{formatActiveTime(today.activeSeconds)}</span>
            <span className={styles.metricLabel}>active today</span>
          </div>
        </div>

        {models.length > 0 && (
          <ul className={styles.models} aria-label="Models seen">
            {models.map((m, i) => (
              <li key={m.label} className={styles.model} style={{ "--i": i } as CSSProperties}>
                <ModelGlyph
                  family={m.model ? modelFamily(m.model) : toolFamily(m.tool)}
                  size={14}
                  className={styles.modelGlyph}
                />
                {m.label}
              </li>
            ))}
          </ul>
        )}

        <div className={styles.action}>
          <Button type="button" onClick={onClose} autoFocus>
            Enter
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
