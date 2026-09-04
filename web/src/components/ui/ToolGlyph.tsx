import type { ToolFamily } from "../../lib/format";

/**
 * Line-art glyphs, one per presence tool — abstract shapes, no brand marks, so
 * they stay monochrome by construction (same convention as ModelGlyph/RoleGlyph).
 * Exported separately so ModelGlyph can fall through to it for tool families.
 */
export function ToolGlyphPath({ family }: { family: ToolFamily }) {
  switch (family) {
    case "claude-code":
      // terminal prompt + a small sparkle
      return (
        <>
          <path d="M4 8l4.5 4.5L4 17" />
          <path d="M10.5 17.5h6" />
          <path d="M18.5 3l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" strokeLinejoin="round" />
        </>
      );
    case "codex":
      // terminal prompt
      return <path d="M5 7l5 5-5 5M13 17h6" />;
    case "cursor":
      // pointer arrow — generic UI iconography
      return <path d="M6 4l13 7.2-5.7 1.4L16 19l-2.7 1.3-2.6-6.3L6 17.5V4z" strokeLinejoin="round" />;
    case "vscode":
    case "windsurf":
    case "zed":
      // editor window: frame + title bar
      return (
        <>
          <rect x="3.5" y="5" width="17" height="14" rx="2" />
          <path d="M3.5 9.5h17" />
        </>
      );
    case "quadcode":
      // 2×2 grid — "quad"
      return (
        <>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </>
      );
    case "chatgpt":
      // speech bubble
      return (
        <path
          d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8.5l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z"
          strokeLinejoin="round"
        />
      );
    case "grok":
      // angular zigzag
      return <path d="M5 19L11 5l2 6 6-6-6 14-2-6-6 6z" strokeLinejoin="round" />;
    case "unknown":
    default:
      // neutral dot-in-circle
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </>
      );
  }
}

interface Props {
  family: ToolFamily;
  size?: number;
  className?: string;
}

/** 24-grid, 1.75px stroke, round caps, currentColor, aria-hidden — pair it with the
 * tool's text label (`toolLabel`), never alone. */
export function ToolGlyph({ family, size = 16, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <ToolGlyphPath family={family} />
    </svg>
  );
}
