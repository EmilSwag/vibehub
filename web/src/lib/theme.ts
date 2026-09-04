import { useCallback, useSyncExternalStore } from "react";

/**
 * Theme preference — the single owner of `<html data-theme>`.
 *
 * - "system" (default): no `data-theme`; tokens.css follows `prefers-color-scheme`.
 * - "light" / "dark": explicit `data-theme`, wins over the OS setting.
 *
 * Persisted in localStorage under `vh-theme` (absent = system). index.html
 * carries a tiny inline script that reads the same key before first paint, so
 * this module only has to keep the attribute in sync from then on. Every
 * storage access is guarded — it can throw in private mode / sandboxed frames,
 * and the app must keep working with an in-memory preference.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "vh-theme";
export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Saved preference, or "system" when nothing (valid) is stored or storage is unavailable. */
export function getStoredTheme(): ThemePreference {
  try {
    const raw = storage()?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

function darkQuery(): MediaQueryList | null {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
    return window.matchMedia(DARK_QUERY);
  } catch {
    return null;
  }
}

export function systemPrefersDark(): boolean {
  return darkQuery()?.matches ?? false;
}

/** What is actually on screen for a preference ("system" → the OS choice). */
export function resolvedTheme(pref: ThemePreference = getStoredTheme()): ResolvedTheme {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

/** Sets/removes `data-theme` on <html>. Idempotent; safe to call before React mounts. */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

/* ---- Module store (one preference for the whole app, no provider needed) ---- */

let cached: ThemePreference | null = null;
const listeners = new Set<() => void>();

function currentPreference(): ThemePreference {
  if (cached === null) cached = getStoredTheme();
  return cached;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Persist + apply + tell every `useTheme()` consumer. "system" clears the stored key. */
export function setTheme(pref: ThemePreference): void {
  cached = pref;
  try {
    const store = storage();
    if (store) {
      if (pref === "system") store.removeItem(THEME_STORAGE_KEY);
      else store.setItem(THEME_STORAGE_KEY, pref);
    }
  } catch {
    /* quota / private mode — keep the in-memory preference for this session */
  }
  applyTheme(pref);
  notify();
}

function subscribePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* Cross-tab sync: another tab changed (or cleared) the key. */
let storageBound = false;
function bindStorageEvents(): void {
  if (storageBound || typeof window === "undefined") return;
  storageBound = true;
  window.addEventListener("storage", (event) => {
    // key === null means storage.clear() — treat as "system" like any other absent value.
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    const next = isThemePreference(event.newValue) ? event.newValue : "system";
    if (next === cached) return;
    cached = next;
    applyTheme(next);
    notify();
  });
}

/**
 * Call once at app boot (main.tsx). Re-applies the stored preference — a
 * no-op after index.html's inline script, but keeps the app correct if that
 * script is ever removed — and starts listening for cross-tab changes.
 */
export function initTheme(): void {
  applyTheme(currentPreference());
  bindStorageEvents();
}

function subscribeSystem(listener: () => void): () => void {
  const mq = darkQuery();
  if (!mq) return () => {};
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }
  // Safari < 14
  mq.addListener(listener);
  return () => mq.removeListener(listener);
}

const subscribeNothing = (): (() => void) => () => {};
const serverPreference = (): ThemePreference => "system";
const serverSystemDark = (): boolean => false;

export interface UseTheme {
  /** What the user chose: "system" | "light" | "dark". */
  preference: ThemePreference;
  /** What is on screen right now. */
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
  /** Flip between light and dark, starting from what is shown — so from "system"
   * it goes to the opposite of the current OS theme (and becomes explicit). */
  toggle: () => void;
}

export function useTheme(): UseTheme {
  const preference = useSyncExternalStore(subscribePreference, currentPreference, serverPreference);
  // Only track the OS setting while it matters; an explicit choice ignores it.
  const systemDark = useSyncExternalStore(
    preference === "system" ? subscribeSystem : subscribeNothing,
    systemPrefersDark,
    serverSystemDark
  );
  const resolved: ResolvedTheme = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  const setPreference = useCallback((pref: ThemePreference) => setTheme(pref), []);
  const toggle = useCallback(() => setTheme(resolved === "dark" ? "light" : "dark"), [resolved]);

  return { preference, resolved, setPreference, toggle };
}
