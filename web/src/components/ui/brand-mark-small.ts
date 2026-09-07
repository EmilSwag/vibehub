import type { BrandMarkPath } from "./brand-mark-paths";
import { BRAND_MARK_PATHS } from "./brand-mark-paths";

/**
 * What to draw below 14px — the tool chip (12) and the tracker row (13).
 *
 * A mark at 12px is a 12x12 bitmap. Measured on the proof sheet's magnifier
 * (`scripts/brand-marks-sheet.mjs` rasterises each mark at exactly 12 CSS px and blows
 * the bitmap up 8x), these four lost the feature that made them themselves: Claude
 * Code's legs and eyes closed into a slab at 42% ink, Codex's chevron drowned in its
 * blob at 68%, Zed's nested Z became a grey tangle at 45%, and the globe's meridians
 * mushed into stripes. Everything else still resolved and is left exactly as published
 * — a mark that reads is never redrawn.
 *
 * These are line art on purpose. A 2.2 stroke on the 24 grid is ~1.1 device px at 12,
 * which stays a line; the same weight as a filled shape closes up. It is also what the
 * pre-round-8 glyphs were, and they read fine at this size.
 *
 * 16px and up always get the real mark. Nothing here is generated: each one is a
 * deliberate redraw, so adding a mark to `brand-mark-paths.ts` never silently adds a
 * simplification too.
 */
export const SMALL_MARKS: Record<string, BrandMarkPath> = {
  /** Claude Code borrows Claude's own burst — same product family, and the burst is
   *  radial, so it keeps its shape all the way down. */
  "claude-code": BRAND_MARK_PATHS.claude,

  /** A plain terminal chevron and its prompt line. Codex is a CLI; this is what a CLI
   *  looks like at 12px, and it is what the mark's own interior was trying to say. */
  codex: {
    d: "M6.5 7l5 5-5 5M14 17h5",
    stroke: 3,
  },

  /** Zed's mark is a Z spiralling inside a square. At 12px the nesting is a tangle,
   *  so only the Z survives. */
  zed: {
    d: "M6.5 6.5h11l-11 11h11",
    stroke: 2.4,
  },

  /** Circle and equator, and nothing else. The meridians are what the full globe loses
   *  first — two curves 2px apart inside an 12px circle are a grey wash, not lines. A
   *  sphere with one banding line still reads as a globe, and stays distinct from the
   *  neutral placeholder (a ring around a solid dot). */
  website: {
    d: "M12 3.4a8.6 8.6 0 1 1 0 17.2 8.6 8.6 0 1 1 0-17.2M3.4 12h17.2",
    stroke: 2,
  },
};
