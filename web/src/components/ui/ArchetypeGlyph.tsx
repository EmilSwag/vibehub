// Four static monochrome glyphs, one per Archetype enum value — no per-user color
// coding (DESIGN.md: "strict monochrome"). Hand-rolled inline SVG, not generated art.

import type { Archetype } from "../../types";

const LABELS: Record<Archetype, string> = {
  CODER: "Coder",
  ARTIST: "Artist",
  DIRECTOR: "Director",
  GENERALIST: "Generalist",
};

/** What the badge cannot say in one word. Wording follows what the classifier
 *  actually measures (server/src/jobs/archetype.ts): a 30-day window, recomputed at
 *  UTC midnight, from commit density, how much the model writes versus the person,
 *  and session length. */
const BLURBS: Record<Archetype, string> = {
  CODER: "Commits often and keeps a hand on the wheel. From your last 30 days.",
  ARTIST: "Design-led work. From your last 30 days.",
  DIRECTOR: "Long sessions, and lets the model run. From your last 30 days.",
  GENERALIST: "No single pattern stands out yet. From your last 30 days.",
};

function GlyphPath({ archetype }: { archetype: Archetype }) {
  switch (archetype) {
    case "CODER":
      // angle brackets
      return (
        <path d="M8 6L3 12l5 6M16 6l5 6-5 6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      );
    case "ARTIST":
      // spark / star
      return (
        <path
          d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8L12 3z"
          stroke="currentColor"
          strokeWidth="1.4"
          fill="none"
          strokeLinejoin="round"
        />
      );
    case "DIRECTOR":
      // compass arrow
      return (
        <>
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <path d="M15 9l-2 5-4 1 2-5 4-1z" fill="currentColor" />
        </>
      );
    case "GENERALIST":
      // hexagon
      return (
        <path
          d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9L12 3z"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="none"
          strokeLinejoin="round"
        />
      );
  }
}

export function ArchetypeGlyph({ archetype, size = 16 }: { archetype: Archetype; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={LABELS[archetype]}
    >
      <GlyphPath archetype={archetype} />
    </svg>
  );
}

export function archetypeLabel(archetype: Archetype): string {
  return LABELS[archetype];
}

export function archetypeBlurb(archetype: Archetype): string {
  return BLURBS[archetype];
}
