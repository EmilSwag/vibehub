import type { ToolFamily } from "../../lib/format";
import { BrandMark } from "./BrandMark";

/**
 * The mark for a presence tool — Claude Code, Cursor, Codex, VS Code, Windsurf, Zed,
 * Quadcode AI, ChatGPT, Grok — monochrome and `currentColor` (round 8; see
 * `BrandMark`, which also holds the exhaustiveness guard that used to live here:
 * a `ToolFamily` added to `format.ts` without a mark is a compile error there).
 *
 * 24-grid, `aria-hidden` — pair it with the tool's text label (`toolLabel`), never alone.
 */
interface Props {
  family: ToolFamily;
  size?: number;
  className?: string;
}

export function ToolGlyph({ family, size = 16, className }: Props) {
  return <BrandMark family={family} size={size} className={className} />;
}
