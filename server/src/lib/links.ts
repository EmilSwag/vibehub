// Hostname -> icon key detection for ExternalLink (ARCHITECTURE.md §2.2). Unknown
// hosts fall back to "generic".
const ICON_MAP: Record<string, string> = {
  "github.com": "github",
  "www.github.com": "github",
  "twitter.com": "twitter",
  "www.twitter.com": "twitter",
  "x.com": "twitter",
  "www.x.com": "twitter",
  "linkedin.com": "linkedin",
  "www.linkedin.com": "linkedin",
  "youtube.com": "youtube",
  "www.youtube.com": "youtube",
  "youtu.be": "youtube",
  "discord.gg": "discord",
  "discord.com": "discord",
  "www.discord.com": "discord",
};

export function detectIcon(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ICON_MAP[hostname] ?? "generic";
  } catch {
    return "generic";
  }
}

export function detectLabel(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url;
  }
}
