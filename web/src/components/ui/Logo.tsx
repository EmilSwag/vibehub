import styles from "./Logo.module.css";
import {
  LOGO_ARCS,
  LOGO_BEAD,
  LOGO_BEAD_RADIUS,
  LOGO_BOX,
  LOGO_CENTRE,
  LOGO_NODE_RADIUS,
  LOGO_RIPPLE_STROKE,
  LOGO_STROKE,
} from "./logo-geometry";

type LogoProps = {
  size?: number;
  /**
   * Run the presence loop. Off by default: a logo that spins forever in the
   * chrome is decoration (skills/emil_design_eng §4). Turn it on where the
   * motion says something -- hover feedback on the top bar, the sign-in moment.
   */
  animated?: boolean;
  className?: string;
};

/**
 * The VibeHub mark: three uneven session arcs, a solid centre node (you), and a
 * bead riding the ring (your live status). Single-colour and driven by
 * `currentColor`, so it inherits `--vh-accent` in both themes and introduces no
 * hue of its own (docs/DESIGN.md).
 *
 * Geometry is generated -- edit scripts/build-brand.mjs and rerun it, never the
 * numbers here. The same source builds assets/branding/*.svg and the Lottie loop.
 */
export function Logo({ size = 24, animated = false, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${LOGO_BOX} ${LOGO_BOX}`}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={[styles.mark, animated && styles.live, className].filter(Boolean).join(" ")}
    >
      {animated && (
        <circle
          className={styles.ripple}
          cx={LOGO_CENTRE}
          cy={LOGO_CENTRE}
          r={LOGO_NODE_RADIUS}
          stroke="currentColor"
          strokeWidth={LOGO_RIPPLE_STROKE}
        />
      )}
      <g stroke="currentColor" strokeWidth={LOGO_STROKE} strokeLinecap="round">
        {LOGO_ARCS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <circle
        className={styles.node}
        cx={LOGO_CENTRE}
        cy={LOGO_CENTRE}
        r={LOGO_NODE_RADIUS}
        fill="currentColor"
      />
      <g className={styles.orbit}>
        <circle cx={LOGO_BEAD.cx} cy={LOGO_BEAD.cy} r={LOGO_BEAD_RADIUS} fill="currentColor" />
      </g>
    </svg>
  );
}
