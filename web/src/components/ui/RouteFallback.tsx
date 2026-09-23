import { Skeleton, SkeletonText } from "./Skeleton";
import styles from "./RouteFallback.module.css";

/**
 * What a lazily loaded route shows while its chunk downloads (App.tsx): the first
 * bands every page opens with — a serif title, a sentence, one card — so the page
 * fills in rather than jumps. No spinner (skills/emil_design_eng §5); on a warm cache
 * this is on screen for a frame or two.
 */
export function RouteFallback() {
  return (
    <div className={styles.wrap} aria-busy="true">
      <Skeleton width={240} height={28} />
      <SkeletonText lines={1} />
      <Skeleton variant="block" height={180} />
    </div>
  );
}
