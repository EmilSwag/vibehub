// Formatting helpers — client-side only, never invents server data.

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
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
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
