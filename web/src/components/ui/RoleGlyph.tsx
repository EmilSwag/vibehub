import type { UserRole } from "../../types";

export interface RoleDef {
  id: UserRole;
  title: string;
  blurb: string;
}

/** The five onboarding cards, in display order. */
export const ROLES: RoleDef[] = [
  { id: "designer", title: "Designer", blurb: "Interfaces, brands, motion. You make it look right." },
  { id: "developer", title: "Developer", blurb: "Code, systems, shipping. You make it work." },
  { id: "gamedev", title: "Game dev", blurb: "Worlds, mechanics, feel. You make it fun." },
  { id: "creator", title: "Creator", blurb: "Video, images, sound. You make things people watch." },
  { id: "founder", title: "Founder", blurb: "Products, teams, bets. You make it happen." },
];

export function roleTitle(role: UserRole | null | undefined): string | null {
  return ROLES.find((r) => r.id === role)?.title ?? null;
}

/**
 * Line-art glyphs, 1.5px stroke, currentColor only — monochrome by construction.
 * Sized by the parent via `size`.
 */
export function RoleGlyph({ role, size = 28 }: { role: UserRole; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (role) {
    case "designer":
      return (
        <svg {...common}>
          <path d="M4 20l4.5-1.5L19 8a2.1 2.1 0 0 0-3-3L5.5 15.5 4 20z" />
          <path d="M14 6.5l3.5 3.5" />
          <circle cx="6" cy="18" r="0.6" fill="currentColor" />
        </svg>
      );
    case "developer":
      return (
        <svg {...common}>
          <path d="M8 7L3 12l5 5" />
          <path d="M16 7l5 5-5 5" />
          <path d="M13.5 5l-3 14" />
        </svg>
      );
    case "gamedev":
      return (
        <svg {...common}>
          <path d="M7 8h10a4 4 0 0 1 4 4v1a4 4 0 0 1-4 4c-1.3 0-2.2-.7-3-1.5H10c-.8.8-1.7 1.5-3 1.5a4 4 0 0 1-4-4v-1a4 4 0 0 1 4-4z" />
          <path d="M8 11v3M6.5 12.5h3" />
          <circle cx="16" cy="11.5" r="0.7" fill="currentColor" />
          <circle cx="18" cy="13.5" r="0.7" fill="currentColor" />
        </svg>
      );
    case "creator":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="13" height="12" rx="2" />
          <path d="M16 10l5-3v10l-5-3" />
          <circle cx="8" cy="12" r="1.8" />
        </svg>
      );
    case "founder":
      return (
        <svg {...common}>
          <path d="M12 3c3 2.5 4.5 6 4.5 9.5L12 15l-4.5-2.5C7.5 9 9 5.5 12 3z" />
          <path d="M7.5 12.5L5 16l3.5-.5M16.5 12.5L19 16l-3.5-.5" />
          <path d="M12 15v5" />
        </svg>
      );
  }
}
