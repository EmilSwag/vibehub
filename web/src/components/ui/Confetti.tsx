import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  size: number;
  shade: number; // 0..1 → lightness
  shape: "dot" | "spark";
}

interface Burst {
  x: number;
  y: number;
  at: number;
}

/**
 * Neat, quiet fireworks — strictly monochrome (skills/emil_design_eng §3/§6).
 * A few bursts of white/gray sparks with gravity and fade; stops itself after
 * `durationMs`, and renders a single static frame under prefers-reduced-motion.
 */
export function Confetti({ durationMs = 5200, bursts = 6 }: { durationMs?: number; bursts?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const isDark = () =>
      document.documentElement.dataset.theme === "dark" ||
      (document.documentElement.dataset.theme !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    let w = 0;
    let h = 0;
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const particles: Particle[] = [];
    const start = performance.now();

    // Schedule bursts across the first ~60% of the show, spread over the upper half.
    const plan: Burst[] = Array.from({ length: bursts }, (_, i) => ({
      x: 0.15 + Math.random() * 0.7,
      y: 0.12 + Math.random() * 0.4,
      at: reduced ? 0 : i * (durationMs * 0.6) / bursts + Math.random() * 120,
    }));

    const explode = (b: Burst) => {
      const cx = b.x * w;
      const cy = b.y * h;
      const n = 46 + Math.floor(Math.random() * 22);
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n + Math.random() * 0.15;
        const speed = 1.6 + Math.random() * 2.6;
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          ttl: 1100 + Math.random() * 900,
          size: 1.2 + Math.random() * 1.8,
          shade: 0.55 + Math.random() * 0.45,
          shape: Math.random() < 0.25 ? "spark" : "dot",
        });
      }
    };

    let raf = 0;
    let last = start;
    let fired = 0;

    const frame = (now: number) => {
      const elapsed = now - start;
      const dt = Math.min(48, now - last);
      last = now;

      while (fired < plan.length && plan[fired].at <= elapsed) {
        explode(plan[fired]);
        fired++;
      }

      ctx.clearRect(0, 0, w, h);
      const dark = isDark();
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.life >= p.ttl) {
          particles.splice(i, 1);
          continue;
        }
        const t = p.life / p.ttl;
        p.vy += 0.028 * (dt / 16); // gentle gravity
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx * (dt / 16);
        p.y += p.vy * (dt / 16);

        const alpha = (1 - t) * (1 - t) * 0.9;
        const l = dark ? Math.round(160 + p.shade * 95) : Math.round(30 + (1 - p.shade) * 90);
        ctx.fillStyle = `rgba(${l}, ${l}, ${l}, ${alpha})`;
        if (p.shape === "spark") {
          ctx.fillRect(p.x - p.size * 1.6, p.y - p.size * 0.35, p.size * 3.2, p.size * 0.7);
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const done = elapsed > durationMs && particles.length === 0;
      if (!done && !reduced) {
        raf = requestAnimationFrame(frame);
      } else if (!reduced) {
        ctx.clearRect(0, 0, w, h);
      }
    };

    if (reduced) {
      // One static, faint frame — celebration without motion.
      plan.forEach(explode);
      for (const p of particles) {
        p.x += p.vx * 18;
        p.y += p.vy * 18;
      }
      const dark = isDark();
      for (const p of particles) {
        const l = dark ? 200 : 90;
        ctx.fillStyle = `rgba(${l}, ${l}, ${l}, 0.35)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [durationMs, bursts]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
