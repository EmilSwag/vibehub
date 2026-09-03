/**
 * VibeHub brand build: one geometry source -> static SVG + seamless Lottie.
 *
 * The mark is a "presence ring": three uneven session arcs, a solid centre node
 * (you), and a bead riding the ring (a live status pulse). Strict monochrome per
 * docs/DESIGN.md - the SVG uses `currentColor`, and Lottie has no such concept, so
 * two colourways are emitted (ink for light UI, paper for dark UI).
 *
 * Run: node scripts/build-brand.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------------------------------------------------------- geometry */

/** Design grid. Every derived asset is this grid times a scale factor. */
const G = {
  box: 48,
  c: 24, //   centre
  r: 16, //   ring radius
  w: 5, //    ring stroke
  node: 6.5, //  centre node radius (the hub, and the loudest shape)
  bead: 4.3, //   travelling bead: 1.7x the ring stroke, so it still reads as a
  //              swelling bump while it crosses an arc rather than vanishing
  ripple: 21, //  the pulse travels past the ring and dissolves; a short throw
  //              inside the empty band just reads as a static grey donut
  rippleW: 1.6, //  a ghost, roughly a third of the ring's weight
  beadAngle: 57, // rest position, inside the wide gap
  /* Uneven on purpose: 86 / 116 / 64 degrees of arc, gaps 24 / 24 / 46.
   * The wide gap sits upper-right where the bead rests, so the silhouette
   * reads as a status pip rather than a symmetrical loading spinner. */
  arcs: [
    [80, 166],
    [190, 306],
    [330, 394],
  ],
};

const RAD = Math.PI / 180;
const round = (n) => Number(n.toFixed(3));

/** Clock angles: 0 deg is 12 o'clock, positive is clockwise. */
function pt(angle, radius = G.r, cx = G.c, cy = G.c) {
  return [cx + radius * Math.sin(angle * RAD), cy - radius * Math.cos(angle * RAD)];
}

/** Unit tangent of the circle at `angle`, pointing clockwise. */
function tangent(angle) {
  return [Math.cos(angle * RAD), Math.sin(angle * RAD)];
}

/**
 * Split an arc into <=90deg cubic segments.
 * Returns [{ p0, c0, c1, p1 }, ...] in the given coordinate space.
 */
function arcToBeziers(a0, a1, radius, cx, cy) {
  const span = a1 - a0;
  const steps = Math.ceil(Math.abs(span) / 90);
  const step = span / steps;
  const k = (4 / 3) * Math.tan((step * RAD) / 4);
  const out = [];
  for (let i = 0; i < steps; i += 1) {
    const s = a0 + step * i;
    const e = s + step;
    const p0 = pt(s, radius, cx, cy);
    const p1 = pt(e, radius, cx, cy);
    const t0 = tangent(s);
    const t1 = tangent(e);
    out.push({
      p0,
      c0: [p0[0] + k * radius * t0[0], p0[1] + k * radius * t0[1]],
      c1: [p1[0] - k * radius * t1[0], p1[1] - k * radius * t1[1]],
      p1,
    });
  }
  return out;
}

/** SVG arc command for one ring segment. */
function arcPath([a0, a1]) {
  const [x0, y0] = pt(a0);
  const [x1, y1] = pt(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${round(x0)} ${round(y0)}A${G.r} ${G.r} 0 ${large} 1 ${round(x1)} ${round(y1)}`;
}

/* -------------------------------------------------------------------- SVG */

const BEAD = pt(G.beadAngle);

const INK = "#111111";
const PAPER = "#F2F2F2";

/**
 * How a standalone SVG resolves its single colour.
 *
 * `auto` follows prefers-color-scheme, which is what a favicon wants. It is the
 * wrong choice for an embedded asset: an `<img>` follows the OS, not the host
 * page, so an auto file goes invisible on a light page under a dark OS. Anything
 * embedded in docs or a README takes an explicit colourway instead.
 *
 * With no mode the file inherits: the SPA sets `color: var(--vh-accent)` and the
 * mark follows the theme for free.
 */
function themeBlock(mode) {
  if (mode === "ink") return `\n  <style>:root { color: ${INK}; }</style>`;
  if (mode === "paper") return `\n  <style>:root { color: ${PAPER}; }</style>`;
  if (mode === "auto") {
    return `\n  <style>\n    :root { color: ${INK}; }\n    @media (prefers-color-scheme: dark) { :root { color: ${PAPER}; } }\n  </style>`;
  }
  return "";
}

/** The static mark. `currentColor` everywhere, so one geometry serves every mode. */
function markSvg({ mode }) {
  const themeStyle = themeBlock(mode);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G.box} ${G.box}" fill="none" role="img" aria-label="VibeHub">${themeStyle}
  <g stroke="currentColor" stroke-width="${G.w}" stroke-linecap="round">
${G.arcs.map((a) => `    <path d="${arcPath(a)}"/>`).join("\n")}
  </g>
  <circle cx="${G.c}" cy="${G.c}" r="${G.node}" fill="currentColor"/>
  <circle cx="${round(BEAD[0])}" cy="${round(BEAD[1])}" r="${G.bead}" fill="currentColor"/>
</svg>
`;
}

/**
 * Horizontal lockup for README / social cards. The wordmark is live text in the
 * DESIGN.md serif stack, so it degrades to a free lookalike where Tiempos is not
 * licensed. Do not convert this to outlines without checking that licence.
 */
function lockupSvg({ mode }) {
  const h = G.box;
  const gap = 14;
  const textX = G.box + gap;
  // The colour rule and the type rule share one block; two <style> tags in one
  // SVG is legal but reads like a mistake.
  const colour = themeBlock(mode).replace(/<\/?style>/g, "").trim();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 208 ${h}" fill="none" role="img" aria-label="VibeHub">
  <style>
    ${colour}
    .wordmark {
      font-family: "Tiempos Text", "Source Serif 4", Georgia, serif;
      font-size: 30px; font-weight: 500; letter-spacing: -0.01em;
      fill: currentColor;
    }
  </style>
  <g stroke="currentColor" stroke-width="${G.w}" stroke-linecap="round">
${G.arcs.map((a) => `    <path d="${arcPath(a)}"/>`).join("\n")}
  </g>
  <circle cx="${G.c}" cy="${G.c}" r="${G.node}" fill="currentColor"/>
  <circle cx="${round(BEAD[0])}" cy="${round(BEAD[1])}" r="${G.bead}" fill="currentColor"/>
  <text class="wordmark" x="${textX}" y="${h / 2}" dominant-baseline="central">VibeHub</text>
</svg>
`;
}

/* ----------------------------------------------------------------- Lottie */

const S = 10; //           design grid -> 480x480 comp, all integers
const BOX = G.box * S;
const CE = G.c * S;
const FR = 60;
const OP = 144; //         2.4s loop
const BEAT = OP / 2; //    two heartbeats per loop

/** Emil's easings (motion.css) expressed as Lottie keyframe tangents. */
const EASE_OUT = { o: { x: [0.22], y: [1] }, i: { x: [0.36], y: [1] } };
const EASE_IN_OUT = { o: { x: [0.65], y: [0] }, i: { x: [0.35], y: [1] } };
const LINEAR = { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } };

/** Build a keyframe list; each entry is [frame, value, easingToNext]. */
function kfs(entries) {
  return entries.map(([t, s, ease], idx) => {
    const last = idx === entries.length - 1;
    if (last) return { t, s: [].concat(s) };
    const e = ease ?? LINEAR;
    return { t, s: [].concat(s), o: e.o, i: e.i };
  });
}

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
};

/** Lottie bezier path for one ring arc, in comp coordinates. */
function lottiePath([a0, a1]) {
  const segs = arcToBeziers(a0, a1, G.r * S, CE, CE);
  const v = segs.map((s) => s.p0).concat([segs[segs.length - 1].p1]);
  const o = segs.map((s) => [s.c0[0] - s.p0[0], s.c0[1] - s.p0[1]]).concat([[0, 0]]);
  const i = [[0, 0]].concat(segs.map((s) => [s.c1[0] - s.p1[0], s.c1[1] - s.p1[1]]));
  return {
    i: i.map((p) => p.map(round)),
    o: o.map((p) => p.map(round)),
    v: v.map((p) => p.map(round)),
    c: false,
  };
}

const staticTransform = (p = [0, 0]) => ({
  ty: "tr",
  p: { a: 0, k: p },
  a: { a: 0, k: [0, 0] },
  s: { a: 0, k: [100, 100] },
  r: { a: 0, k: 0 },
  o: { a: 0, k: 100 },
  sk: { a: 0, k: 0 },
  sa: { a: 0, k: 0 },
});

function layer(nm, ind, shapes, ks = {}) {
  return {
    ddd: 0,
    ind,
    ty: 4,
    nm,
    sr: 1,
    ks: {
      o: { a: 0, k: 100, ix: 11 },
      r: { a: 0, k: 0, ix: 10 },
      p: { a: 0, k: [CE, CE, 0], ix: 2 },
      a: { a: 0, k: [0, 0, 0], ix: 1 },
      s: { a: 0, k: [100, 100, 100], ix: 6 },
      ...ks,
    },
    ao: 0,
    shapes,
    ip: 0,
    op: OP,
    st: 0,
    bm: 0,
  };
}

function buildLottie(hex, name) {
  const c = rgb(hex);
  const stroke = (w) => ({
    ty: "st",
    c: { a: 0, k: c },
    o: { a: 0, k: 100 },
    w: { a: 0, k: w },
    lc: 2,
    lj: 2,
    nm: "Stroke",
  });
  const fill = { ty: "fl", c: { a: 0, k: c }, o: { a: 0, k: 100 }, r: 1, nm: "Fill" };

  /* The bead rides the ring: one exact revolution per loop, linear, so the
   * first and last frame are identical and the seam is invisible. */
  const bead = layer(
    "bead",
    1,
    [
      {
        ty: "gr",
        nm: "bead",
        it: [
          { ty: "el", p: { a: 0, k: [0, -G.r * S] }, s: { a: 0, k: [G.bead * 2 * S, G.bead * 2 * S] }, nm: "Ellipse" },
          fill,
          staticTransform(),
        ],
      },
    ],
    { r: { a: 1, k: kfs([[0, [G.beadAngle], LINEAR], [OP, [G.beadAngle + 360]]]), ix: 10 } }
  );

  const ring = layer("ring", 2, [
    {
      ty: "gr",
      nm: "arcs",
      it: [
        ...G.arcs.map((a, idx) => ({
          ty: "sh",
          ind: idx,
          ks: { a: 0, k: lottiePath(a) },
          nm: `arc-${idx}`,
        })),
        stroke(G.w * S),
        staticTransform([-CE, -CE]),
      ],
    },
  ]);

  /* Heartbeat: fast out on Emil's --ease-out, slow settle on --ease-in-out.
   * Flat either side of the seam, so value and velocity both match at wrap. */
  const node = layer(
    "node",
    3,
    [
      {
        ty: "gr",
        nm: "node",
        it: [
          { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [G.node * 2 * S, G.node * 2 * S] }, nm: "Ellipse" },
          fill,
          staticTransform(),
        ],
      },
    ],
    {
      s: {
        a: 1,
        ix: 6,
        k: kfs([
          [0, [100, 100, 100], EASE_OUT],
          [8, [112, 112, 100], EASE_IN_OUT],
          [44, [100, 100, 100], LINEAR],
          [BEAT, [100, 100, 100], EASE_OUT],
          [BEAT + 8, [112, 112, 100], EASE_IN_OUT],
          [BEAT + 44, [100, 100, 100], LINEAR],
          [OP, [100, 100, 100]],
        ]),
      },
    }
  );

  /* The pulse leaving you and reaching the ring. Opacity is 0 at both ends of
   * every cycle, so the reset back to the node is never visible. */
  const rippleCycle = (start) => [
    [start, 0, EASE_OUT],
    [start + 4, 18, EASE_IN_OUT],
    [start + 62, 0, LINEAR],
    [start + BEAT, 0],
  ];
  const ripple = layer("ripple", 4, [
    {
      ty: "gr",
      nm: "ripple",
      it: [
        {
          ty: "el",
          p: { a: 0, k: [0, 0] },
          s: {
            a: 1,
            k: kfs([
              [0, [G.node * 2 * S, G.node * 2 * S], EASE_OUT],
              [62, [G.ripple * 2 * S, G.ripple * 2 * S], LINEAR],
              [BEAT, [G.node * 2 * S, G.node * 2 * S], EASE_OUT],
              [BEAT + 62, [G.ripple * 2 * S, G.ripple * 2 * S], LINEAR],
              [OP, [G.node * 2 * S, G.node * 2 * S]],
            ]),
          },
          nm: "Ellipse",
        },
        stroke(G.rippleW * S),
        {
          ...staticTransform(),
          o: { a: 1, k: kfs([...rippleCycle(0).slice(0, 3), ...rippleCycle(BEAT)]) },
        },
      ],
    },
  ]);

  return {
    v: "5.9.0",
    fr: FR,
    ip: 0,
    op: OP,
    w: BOX,
    h: BOX,
    nm: name,
    ddd: 0,
    assets: [],
    layers: [bead, ring, node, ripple],
    markers: [],
  };
}

/* ------------------------------------------------------------------ write */

const out = (rel, body) => {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
  console.log("wrote", rel);
};

/** The in-app mark is inline JSX, so it takes the geometry from here too. */
function geometryModule() {
  return `// Generated by scripts/build-brand.mjs. Do not edit by hand.
// Shared geometry for the in-app mark; the standalone SVG and the Lottie loop
// in assets/branding are built from the same numbers.

export const LOGO_BOX = ${G.box};
export const LOGO_CENTRE = ${G.c};
export const LOGO_RING_RADIUS = ${G.r};
export const LOGO_STROKE = ${G.w};
export const LOGO_NODE_RADIUS = ${G.node};
export const LOGO_BEAD_RADIUS = ${G.bead};
export const LOGO_RIPPLE_RADIUS = ${G.ripple};
export const LOGO_RIPPLE_STROKE = ${G.rippleW};
/** Scale the ripple circle (drawn at ring radius) down to the node edge. */
export const LOGO_RIPPLE_FROM = ${round(G.node / G.r)};
export const LOGO_RIPPLE_TO = ${round(G.ripple / G.r)};
export const LOGO_BEAD = { cx: ${round(BEAD[0])}, cy: ${round(BEAD[1])} };
export const LOGO_ARCS = [
${G.arcs.map((a) => `  "${arcPath(a)}",`).join("\n")}
];
`;
}

out("web/src/components/ui/logo-geometry.ts", geometryModule());

// `mark.svg` is the favicon, so it follows the OS. Everything meant to be
// embedded somewhere gets an explicit colourway.
out("assets/branding/vibehub-mark.svg", markSvg({ mode: "auto" }));
out("assets/branding/vibehub-mark-ink.svg", markSvg({ mode: "ink" }));
out("assets/branding/vibehub-mark-paper.svg", markSvg({ mode: "paper" }));
out("assets/branding/vibehub-lockup-ink.svg", lockupSvg({ mode: "ink" }));
out("assets/branding/vibehub-lockup-paper.svg", lockupSvg({ mode: "paper" }));
out("web/public/brand/mark.svg", markSvg({ mode: "auto" }));

const ink = buildLottie("#111111", "VibeHub mark loop (ink)");
const paper = buildLottie("#F2F2F2", "VibeHub mark loop (paper)");
for (const [rel, doc] of [
  ["assets/branding/vibehub-mark-loop-ink.json", ink],
  ["assets/branding/vibehub-mark-loop-paper.json", paper],
  ["web/public/brand/mark-loop-ink.json", ink],
  ["web/public/brand/mark-loop-paper.json", paper],
]) {
  out(rel, JSON.stringify(doc));
}
