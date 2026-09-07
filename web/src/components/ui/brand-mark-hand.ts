import type { BrandMarkPath } from "./brand-mark-paths";

/**
 * The two marks with no third-party source, drawn by hand on the same 24 grid as the
 * extracted ones in `brand-mark-paths.ts`: solid fills, no stroke, nonzero fill-rule
 * with counter-wound counters so a hole stays a hole when a later subpath crosses it.
 *
 * Data only, no JSX — `scripts/brand-marks-sheet.mjs` loads this module directly to
 * build the proof sheet, so what is verified is exactly what ships.
 */
export const HAND_DRAWN_MARKS = {
  /** Quadcode AI — a clean Q: even ring, tail crossing it on the diagonal. Ours to
   *  draw, so it is drawn to the grid rather than traced: r10 ring 3 thick, and a
   *  3-wide capsule running from inside the counter to just past the outer edge. */
  quadcode: {
    d:
      "M2 12a10 10 0 1 1 20 0 10 10 0 1 1-20 0Z" +
      "M5 12a7 7 0 1 0 14 0 7 7 0 1 0-14 0Z" +
      "M16.661 14.539l4 4a1.5 1.5 0 0 1-2.122 2.122l-4-4a1.5 1.5 0 0 1 2.122-2.122Z",
  },
  /** LinkedIn — the "in" letterform: dot, stem, and the n's shoulder. simple-icons
   *  v16 no longer carries it, and the shape is regular enough to hold by hand; this
   *  is the path LinkIcon has shipped since the profile header existed. */
  linkedin: {
    d:
      "M6.94 8.5H3.56V21h3.38V8.5z" +
      "M5.25 3a1.96 1.96 0 1 0 0 3.92 1.96 1.96 0 0 0 0-3.92z" +
      "M21 21h-3.37v-6.34c0-1.51-.03-3.46-2.11-3.46-2.11 0-2.44 1.65-2.44 3.35V21H9.7V8.5h3.24v1.71h.05c.45-.86 1.56-1.76 3.21-1.76 3.43 0 4.06 2.26 4.06 5.19V21z",
  },
  /** A website — a globe, because there is no brand to be faithful to. The fallback
   *  for every link whose host the server did not recognise, which in practice means
   *  somebody's own site. */
  website: {
    d: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm7.93 9h-3.1a15.6 15.6 0 0 0-1.19-5.36A8.03 8.03 0 0 1 19.93 11zM12 4.06c.9 1.16 1.9 3.1 2.13 6.94H9.87c.23-3.84 1.23-5.78 2.13-6.94zM9.87 13h4.26c-.23 3.84-1.23 5.78-2.13 6.94-.9-1.16-1.9-3.1-2.13-6.94zM8.36 5.64A15.6 15.6 0 0 0 7.17 11h-3.1a8.03 8.03 0 0 1 4.29-5.36zM4.07 13h3.1a15.6 15.6 0 0 0 1.19 5.36A8.03 8.03 0 0 1 4.07 13zm11.57 5.36A15.6 15.6 0 0 0 16.83 13h3.1a8.03 8.03 0 0 1-4.29 5.36z",
  },
  /** "a model or tool, unnamed" — the one shape that is deliberately not a brand.
   *  Carried over from the line-art set so an unrecognised id still reads as a
   *  placeholder and never borrows someone else's mark. */
  neutral: {
    d:
      "M3 12a9 9 0 1 1 18 0 9 9 0 1 1-18 0Z" +
      "M4.6 12a7.4 7.4 0 1 0 14.8 0 7.4 7.4 0 1 0-14.8 0Z" +
      "M12 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 1 1 0-3.2Z",
  },
} as const satisfies Record<string, BrandMarkPath>;
