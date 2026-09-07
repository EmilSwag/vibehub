import type { ModelFamily, ToolFamily } from "../../lib/format";
import { BrandMark } from "./BrandMark";

/**
 * The mark for a model family — Claude, OpenAI, Gemini, Grok — monochrome and
 * `currentColor` (round 8 replaced the abstract line-art sparkles with the real
 * marks; see `BrandMark`).
 *
 * Tool families are accepted too and resolve to their own mark, so a
 * `modelFamily()`/`toolFamily()` result can be passed here without a branch —
 * prefer <ToolGlyph/> when you know it's a tool.
 */
interface Props {
  family: ModelFamily | ToolFamily;
  size?: number;
  className?: string;
}

export function ModelGlyph({ family, size = 16, className }: Props) {
  return <BrandMark family={family} size={size} className={className} />;
}
