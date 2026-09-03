import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/**
 * Per-item entrance delay for `.stagger` parents (see styles/motion.css).
 * Usage: `<div style={stagger(i)}>` — sets the `--i` custom property.
 */
export function stagger(index: number): CSSProperties {
  const vars: Record<string, number> = { "--i": index };
  return vars as CSSProperties;
}

/**
 * Keeps a conditionally-rendered block mounted long enough to play its exit
 * animation instead of vanishing instantly. Pair with the `.leave` utility
 * (styles/motion.css): `{render && <div className={closing ? "leave" : "reveal"}>}`.
 */
export function useExitTransition(open: boolean, duration = 200): { render: boolean; closing: boolean } {
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (open) {
      setRender(true);
      setClosing(false);
    } else {
      setClosing(true);
      timer.current = window.setTimeout(() => {
        setRender(false);
        setClosing(false);
      }, duration);
    }
    return () => window.clearTimeout(timer.current);
  }, [open, duration]);

  return { render: render || open, closing };
}
