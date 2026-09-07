// Renders the icon key the server already detected (ARCHITECTURE.md §2.2) — the
// client never re-detects from the URL, it maps a known key to a mark with a fallback.
//
// Round 8 replaced the traced approximations here with the real marks from the same
// generated table the model/tool glyphs use (`brand-mark-paths.ts`, CC0). LinkedIn and
// the website globe have no third-party source and are drawn by hand next to the other
// hand-drawn marks (`brand-mark-hand.ts`).
//
// `telegram` is wired here but the server does not detect it yet: `detectIcon` in
// server/src/lib/links.ts has no `t.me` / `telegram.org` entry, so the key never
// arrives and a Telegram link falls back to the website globe.

import type { BrandMarkPath } from "./ui/brand-mark-paths";
import { MarkGlyph, markById } from "./ui/BrandMark";

/** Icon key (as the server detects it) → mark. Goes through `markById` rather than
 *  the raw tables so a link mark picks up its 12px redraw like any other. Exported so
 *  the proof sheet renders the same table the header does. */
export const LINK_MARKS: Record<string, BrandMarkPath> = {
  github: markById("github"),
  // The server still calls the key "twitter" (it maps both twitter.com and x.com to
  // it); the mark is X, which is what the product is.
  twitter: markById("x"),
  x: markById("x"),
  telegram: markById("telegram"),
  youtube: markById("youtube"),
  discord: markById("discord"),
  linkedin: markById("linkedin"),
  // "generic" is what the server sends for a host it does not recognise — in practice
  // somebody's own site, so it gets the globe rather than a chain link.
  site: markById("website"),
  generic: markById("website"),
};

export function LinkIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  return <MarkGlyph mark={LINK_MARKS[icon] ?? LINK_MARKS.generic} size={size} />;
}
