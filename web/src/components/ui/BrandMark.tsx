import type { ModelFamily, ToolFamily } from "../../lib/format";
import type { BrandMarkPath } from "./brand-mark-paths";
import { BRAND_MARK_PATHS } from "./brand-mark-paths";
import { HAND_DRAWN_MARKS } from "./brand-mark-hand";
import { SMALL_MARKS } from "./brand-mark-small";

/**
 * The real mark for a model or tool family — Claude, Cursor, Gemini, OpenAI, Grok —
 * monochrome, `currentColor`, on the same 24 grid as `Icon.tsx`.
 *
 * Round 8 reversed the old "abstract shapes only, no brand marks" rule (which
 * RoleGlyph/ArchetypeGlyph still follow — those name a *person*, and there is no
 * brand to be faithful to). Monochrome is unchanged and non-negotiable: the marks
 * carry no fill of their own, so they inherit whatever `--vh-*` colour the call site
 * sets, exactly as the line-art glyphs did, and introduce no hue in either theme.
 *
 * Never rendered alone — always beside its own name (`toolLabel` / `humanizeModel`),
 * which is why it is `aria-hidden`.
 */

const BASE_MARKS: Record<string, BrandMarkPath> = { ...BRAND_MARK_PATHS, ...HAND_DRAWN_MARKS };

/** Marks with a 12px redraw carry it on `small`; everything else is untouched, so
 *  `markAt` falls straight through to the published geometry. */
const MARKS: Record<string, BrandMarkPath> = Object.fromEntries(
  Object.entries(BASE_MARKS).map(([id, mark]) => [id, SMALL_MARKS[id] ? { ...mark, small: SMALL_MARKS[id] } : mark]),
);

type MarkId = keyof typeof BRAND_MARK_PATHS | keyof typeof HAND_DRAWN_MARKS;

/**
 * Below this, a mark is drawn at whatever detail survives 12 device pixels; at or
 * above it, always the real mark. 14 is the line because the two slots underneath it
 * are the tool chip (12) and the tracker row (13) — 16 and 26 are unchanged.
 */
export const SMALL_BELOW = 14;

/** The geometry actually painted at `size` — the real mark, or its 12px redraw. */
export function markAt(mark: BrandMarkPath, size: number): BrandMarkPath {
  return size < SMALL_BELOW ? (mark.small ?? mark) : mark;
}

/**
 * Family → mark. `Record` over the full union makes this exhaustive: a family added
 * to `format.ts` without a mark is a compile error here, which is the guard the old
 * `unglyphed(_family: never)` provided. Several families share a mark on purpose —
 * ChatGPT and the GPT model family are both the OpenAI blossom, because that is what
 * those products actually use.
 */
export const MARK_BY_FAMILY: Record<ModelFamily | ToolFamily, MarkId> = {
  // Model families
  claude: "claude",
  gpt: "openai",
  gemini: "gemini",
  // Tool families
  "claude-code": "claude-code",
  codex: "codex",
  cursor: "cursor",
  vscode: "vscode",
  windsurf: "windsurf",
  zed: "zed",
  quadcode: "quadcode",
  chatgpt: "openai",
  // In both unions
  grok: "grok",
  unknown: "neutral",
};

/**
 * The mark a family resolves to. The component, the contract check and the proof
 * sheet all go through this, so none of the three can drift from the others.
 *
 * `?? "neutral"` is unreachable through the type; it is the runtime floor for a raw
 * id cast in, or an older bundle passing a family this build does not know.
 */
export function brandMarkFor(family: ModelFamily | ToolFamily): BrandMarkPath {
  return markById(MARK_BY_FAMILY[family] ?? "neutral");
}

/** A mark by its own id, for the slots that are not keyed by family — `LinkIcon` maps
 *  the server's link icon key onto these. Goes through the same table, so a link mark
 *  gets its 12px redraw exactly like a tool mark does. */
export function markById(id: string): BrandMarkPath {
  return MARKS[id] ?? MARKS.neutral;
}

/**
 * The <svg> a mark is painted in — 24 grid, `currentColor`, `aria-hidden` because a
 * mark never carries meaning without its label beside it. Shared with `LinkIcon`,
 * whose marks come from the same table but are keyed by the link icon the server
 * detected rather than by a model or tool family.
 *
 * Solid by default; a variant that declares `stroke` is painted as line art instead,
 * which is what the 12px redraws need to stay open at that size.
 */
export function MarkGlyph({
  mark,
  size = 16,
  className,
}: {
  mark: BrandMarkPath;
  size?: number;
  className?: string;
}) {
  const drawn = markAt(mark, size);
  const stroked = drawn.stroke !== undefined;
  const path = <path d={drawn.d} fillRule={drawn.fillRule} />;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={stroked ? "none" : "currentColor"}
      stroke={stroked ? "currentColor" : undefined}
      strokeWidth={drawn.stroke}
      strokeLinecap={stroked ? "round" : undefined}
      strokeLinejoin={stroked ? "round" : undefined}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {drawn.transform ? <g transform={drawn.transform}>{path}</g> : path}
    </svg>
  );
}

interface Props {
  family: ModelFamily | ToolFamily;
  size?: number;
  className?: string;
}

/**
 * 24-grid, solid `currentColor` fill, no stroke — crisp at 12, 16 and 26 because the
 * path data is never re-fitted and the box is never inset. A mark whose source grid
 * was not 24 is scaled by a `<g transform>`, which the browser applies before
 * rasterising, so small sizes lose nothing.
 */
export function BrandMark({ family, size = 16, className }: Props) {
  return <MarkGlyph mark={brandMarkFor(family)} size={size} className={className} />;
}
