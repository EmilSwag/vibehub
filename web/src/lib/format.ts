// Formatting helpers — client-side only, never invents server data.
// One locale everywhere, explicit on every Intl call — a bare .toLocaleDateString()
// silently follows the visitor's OS/browser locale, which reads as broken when it
// lands next to this file's hand-formatted "3d ago" strings (round-5 design QA).
const LOCALE = "en-US";

export function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function elapsedShort(iso: string): string {
  const ms = Math.max(0, Date.now() - new Date(iso).getTime());
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

// "in project neon-app · Claude Code · 1h 42m" — exact shape from ARCHITECTURE.md §4.4.
export function presenceLine(activity: {
  projectAlias: string;
  tool: string;
  startedAt: string;
}): string {
  return `in project ${activity.projectAlias} · ${activity.tool} · ${elapsedShort(activity.startedAt)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatActiveTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Sep 3" — no year. The one shared shape for card/list dates sitewide. */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
}

/** "Sep 3, 2026, 6:45 PM" — for "last seen" / device-token style timestamps. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
