import { useEffect } from "react";
import { showSkewToast } from "../components/ui/SkewToast";
import { useAuth } from "../context/AuthContext";
import { ACHIEVEMENTS_DEF, knownAchievements } from "../lib/achievements";
import { diffUnlocks, readSeen, seenStorageKey, writeSeen } from "../lib/achievementUnlocks";
import { achievementsApi } from "../lib/api";

/**
 * How often the signed-in person's own badges are re-read. Each read is also what
 * makes the server evaluate and persist a fresh unlock (routes/achievements.ts), so
 * this is the moment a badge is stamped — and the feed learns of it — in practice.
 */
export const UNLOCK_POLL_MS = 60_000;

/**
 * The owner's unlock toast — meta/plans/vibehub-honest-achievements-feed.md, B4.
 *
 * Mounted once in AppLayout. Signed out it does nothing. Signed in it reads the
 * account's achievements on mount and every minute while the tab is visible, diffs
 * the unlocked ids against the per-account seen set (lib/achievementUnlocks.ts) and
 * fires the skew toast with fireworks for each new one. The first run on a device
 * seeds silently.
 */
export function useAchievementUnlocks(): void {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const username = user?.username ?? null;

  useEffect(() => {
    if (!userId || !username) return;
    const key = seenStorageKey(userId);
    let alive = true;
    let inFlight = false;
    let timer: number | undefined;

    // Accessing localStorage can itself throw (blocked storage); that is "no storage".
    const storage = (): Storage | null => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    };

    const check = async () => {
      if (!alive || inFlight) return;
      inFlight = true;
      try {
        const { achievements } = await achievementsApi.get(username);
        if (!alive) return;
        const store = storage();
        const { announce, next } = diffUnlocks(readSeen(store, key), knownAchievements(achievements));
        // Record first, then celebrate: a toast that throws must not fire twice.
        writeSeen(store, key, next);
        announce.forEach((badge, i) => {
          const def = ACHIEVEMENTS_DEF[badge.id];
          showSkewToast({
            badgeId: badge.id,
            category: "Achievement unlocked",
            title: def.title,
            subtitle: `${def.tagline} · ${def.requirement}`,
            duration: 10_000,
            // Several badges can land in one sync; one fireworks show is enough.
            fireworks: i === 0,
          });
        });
      } catch {
        // A failed poll (offline, an older server without the route) proves nothing;
        // the next one looks again.
      } finally {
        inFlight = false;
      }
    };

    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    // Poll only while the tab is visible; regaining focus reads immediately.
    const sync = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      void check();
      timer = window.setInterval(() => void check(), UNLOCK_POLL_MS);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [userId, username]);
}
