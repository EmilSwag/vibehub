import type { SVGProps } from "react";
import type { AchievementId } from "../../lib/achievements";

interface BadgeIconProps extends SVGProps<SVGSVGElement> {
  id: AchievementId;
  size?: number;
  unlocked?: boolean;
}

export function BadgeIcon({ id, size = 32, unlocked = true, className, ...props }: BadgeIconProps) {
  const stroke = unlocked ? "currentColor" : "var(--vh-text-faint)";
  const fill = unlocked ? "currentColor" : "none";

  switch (id) {
    case "token-millionaire":
      // Precision faceted diamond / token crystal with starspark
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          stroke={stroke}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
          {...props}
        >
          {/* Outer diamond */}
          <polygon points="16,3 28,11 16,29 4,11" fill={unlocked ? "rgba(255, 255, 255, 0.08)" : "none"} />
          {/* Top facet line */}
          <line x1="4" y1="11" x2="28" y2="11" />
          {/* Internal diagonal facets */}
          <line x1="16" y1="3" x2="11" y2="11" />
          <line x1="16" y1="3" x2="21" y2="11" />
          <line x1="11" y1="11" x2="16" y2="29" />
          <line x1="21" y1="11" x2="16" y2="29" />
          {/* Sparkle node */}
          {unlocked && (
            <circle cx="16" cy="11" r="1.75" fill={fill} stroke="none" />
          )}
        </svg>
      );

    case "opus-tamer":
      // Crown constellation / majestic crest
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          stroke={stroke}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
          {...props}
        >
          {/* Crown perimeter */}
          <polygon
            points="5,24 27,24 28,9 21,15 16,6 11,15 4,9"
            fill={unlocked ? "rgba(255, 255, 255, 0.08)" : "none"}
          />
          {/* Base bar */}
          <line x1="5" y1="24" x2="27" y2="24" strokeWidth="2.5" />
          {/* Crown jewels / nodes */}
          <circle cx="4" cy="9" r="1.5" fill={fill} />
          <circle cx="16" cy="6" r="1.75" fill={fill} />
          <circle cx="28" cy="9" r="1.5" fill={fill} />
          {/* Center radiance */}
          {unlocked && <line x1="16" y1="13" x2="16" y2="19" strokeWidth="1.5" />}
        </svg>
      );

    case "night-owl":
      // Minimal geometric owl face with crescent moon wings
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          stroke={stroke}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
          {...props}
        >
          {/* Crescent moon silhouette */}
          <path d="M19 4A12 12 0 0 0 28 17 12 12 0 1 1 15 3a12 12 0 0 0 4 1z" strokeDasharray={unlocked ? "none" : "3 3"} />
          {/* Owl eyes */}
          <circle cx="11" cy="16" r="3" fill={unlocked ? "rgba(255, 255, 255, 0.12)" : "none"} />
          <circle cx="11" cy="16" r="1.25" fill={fill} />
          <circle cx="21" cy="16" r="3" fill={unlocked ? "rgba(255, 255, 255, 0.12)" : "none"} />
          <circle cx="21" cy="16" r="1.25" fill={fill} />
          {/* Sharp beak */}
          <polygon points="16,18 18,22 14,22" fill={fill} stroke={stroke} strokeWidth="1" />
          {/* Ear tufts */}
          <polyline points="7,10 9,13" />
          <polyline points="25,10 23,13" />
        </svg>
      );

    case "deep-flow":
      // Concentric focus rings / vortex portal
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          stroke={stroke}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
          {...props}
        >
          {/* Outer hexagonal gate */}
          <polygon
            points="16,3 27,9 27,23 16,29 5,23 5,9"
            fill={unlocked ? "rgba(255, 255, 255, 0.06)" : "none"}
            strokeDasharray={unlocked ? "none" : "4 2"}
          />
          {/* Middle circle */}
          <circle cx="16" cy="16" r="7" strokeWidth="1.5" />
          {/* Inner core pulse */}
          <circle cx="16" cy="16" r="3" fill={fill} />
          {/* Crosshair accents */}
          <line x1="16" y1="5" x2="16" y2="7" />
          <line x1="16" y1="25" x2="16" y2="27" />
          <line x1="5" y1="16" x2="7" y2="16" />
          <line x1="25" y1="16" x2="27" y2="16" />
        </svg>
      );

    case "polyglot":
      // Connected multi-tool polygon nodes
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          stroke={stroke}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
          {...props}
        >
          {/* Central connecting hub */}
          <circle cx="16" cy="16" r="3.5" fill={unlocked ? "rgba(255, 255, 255, 0.15)" : "none"} />
          <circle cx="16" cy="16" r="1.5" fill={fill} />
          {/* 3 peripheral satellite nodes */}
          <line x1="16" y1="12.5" x2="16" y2="6.5" />
          <circle cx="16" cy="5" r="2.5" fill={fill} />

          <line x1="13" y1="18" x2="7" y2="23" />
          <circle cx="6" cy="24" r="2.5" fill={fill} />

          <line x1="19" y1="18" x2="25" y2="23" />
          <circle cx="26" cy="24" r="2.5" fill={fill} />

          {/* Orbit arc */}
          <path d="M7 11 A 12 12 0 0 1 25 11" strokeDasharray="2 3" strokeWidth="1.25" />
        </svg>
      );

    case "streak-master":
      // Dynamic geometric 7-ray flame & step ladder
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          stroke={stroke}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
          {...props}
        >
          {/* Stylized sharp flame */}
          <path
            d="M16 3 C16 3 10 11 10 17 A6 6 0 0 0 22 17 C22 12 17 8 16 3 Z"
            fill={unlocked ? "rgba(255, 255, 255, 0.08)" : "none"}
          />
          {/* Inner core flame */}
          <path
            d="M16 12 C16 12 13 16 13 19 A3 3 0 0 0 19 19 C19 16 16.5 14 16 12 Z"
            fill={fill}
          />
          {/* Stepped momentum base lines */}
          <line x1="7" y1="26" x2="25" y2="26" strokeWidth="2" />
          <line x1="10" y1="29" x2="22" y2="29" strokeWidth="1.5" />
        </svg>
      );

    default:
      return null;
  }
}
