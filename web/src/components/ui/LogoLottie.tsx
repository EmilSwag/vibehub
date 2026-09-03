import { useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import styles from "./LogoLottie.module.css";

type LogoLottieProps = {
  size?: number;
  className?: string;
};

/**
 * The brand loop as the shipped Lottie (assets/branding/vibehub-mark-loop-ink.json),
 * used on the one screen where the mark is a moment rather than chrome.
 *
 * lottie-web is a quarter of a megabyte, so it is imported dynamically and kept
 * out of the main bundle. The CSS mark stands in until the player lands, and
 * stays for good if the import fails or the visitor prefers reduced motion --
 * the two animations are the same loop, so the swap is invisible.
 */
export function LogoLottie({ size = 56, className }: LogoLottieProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    let anim: { destroy: () => void } | null = null;

    import("lottie-web/build/player/lottie_light")
      .then(({ default: lottie }) => {
        if (cancelled || !host.current) return;
        anim = lottie.loadAnimation({
          container: host.current,
          renderer: "svg",
          loop: true,
          autoplay: true,
          path: "/brand/mark-loop-ink.json",
        });
        setPlaying(true);
      })
      .catch(() => {
        /* Keep the CSS mark. A missing player is not worth an error state. */
      });

    return () => {
      cancelled = true;
      anim?.destroy();
      anim = null;
    };
  }, []);

  return (
    <div
      className={[styles.host, className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
    >
      {!playing && <Logo size={size} animated />}
      <div ref={host} className={styles.player} aria-hidden="true" />
    </div>
  );
}
