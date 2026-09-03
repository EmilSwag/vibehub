import type { CSSProperties } from "react";

/**
 * Per-item entrance delay for `.stagger` parents (see styles/motion.css).
 * Usage: `<div style={stagger(i)}>` — sets the `--i` custom property.
 */
export function stagger(index: number): CSSProperties {
  const vars: Record<string, number> = { "--i": index };
  return vars as CSSProperties;
}
