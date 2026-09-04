import type { ModelFamily, ToolFamily } from "../../lib/format";
import { ToolGlyphPath } from "./ToolGlyph";

/**
 * Line-art glyphs, one per model family, monochrome by construction (no brand
 * marks — abstract shapes only, same convention as RoleGlyph/ArchetypeGlyph).
 * 1.75px stroke, round caps, currentColor — matches Icon.tsx's icon system.
 *
 * Tool families are accepted too and fall through to ToolGlyph's shapes, so a
 * `modelFamily()`/`toolFamily()` result can be passed here without a branch —
 * prefer <ToolGlyph/> when you know it's a tool.
 */
function GlyphPath({ family }: { family: ModelFamily | ToolFamily }) {
  switch (family) {
    case "claude":
      // soft six-point sparkle
      return (
        <path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.5 3.5M14.9 14.9l3.5 3.5M18.4 5.6l-3.5 3.5M9.1 14.9l-3.5 3.5" />
      );
    case "gpt":
      // two overlapping circles — a conversation, abstracted
      return (
        <>
          <circle cx="9.5" cy="12" r="6" />
          <circle cx="14.5" cy="12" r="6" />
        </>
      );
    case "gemini":
      // twin dots, unconnected — duality without overlap
      return (
        <>
          <circle cx="8" cy="12" r="4.5" />
          <circle cx="16.5" cy="12" r="2.8" />
        </>
      );
    case "grok":
      // angular zigzag
      return <path d="M5 19L11 5l2 6 6-6-6 14-2-6-6 6z" strokeLinejoin="round" />;
    case "unknown":
      // neutral dot-in-circle — "a model, unnamed"
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </>
      );
    default:
      return <ToolGlyphPath family={family} />;
  }
}

interface Props {
  family: ModelFamily | ToolFamily;
  size?: number;
  className?: string;
}

export function ModelGlyph({ family, size = 16, className }: Props) {
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
      <GlyphPath family={family} />
    </svg>
  );
}
